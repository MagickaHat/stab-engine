/**
 * @file marshal.ts
 * @brief Reader for Ruby's Marshal format (version 4.8), the format of
 *        RPG Maker XP / Pokémon Essentials `.rxdata` files.
 *
 * Only reads data: no Ruby code runs and no classes are created, so it is
 * safe on files from anywhere. Ruby objects come back as `RubyObject`s
 * holding their class name and instance variables.
 *
 * | Ruby | Result |
 * |------|--------|
 * | `nil`, `true`, `false` | `null`, `true`, `false` |
 * | Integer, Float | `number` (huge integers lose precision) |
 * | String, Symbol | `string` (strings are read as UTF-8) |
 * | Array | `unknown[]` |
 * | Hash | `Map` |
 * | Object | `RubyObject` (`ivars` without the `@`) |
 * | Array/String/Hash subclass (`class PBAnimation < Array`) | `RubyObject` with `value` |
 * | `_dump` object (`Color`, `Tone`, `Table`) | `RubyObject` with `data` (raw bytes) |
 */

/** @brief A Ruby object: its class and instance variables. */
export class RubyObject
{
    /** Instance variables, names without the leading `@`. */
    readonly ivars: Record<string, unknown> = {};
    /** For subclasses of built-in types: the Array/String/Hash itself. */
    value?: unknown;
    /** For classes that save themselves with `_dump`: the saved bytes. */
    data?: Uint8Array;
    /** Ruby class name, e.g. `'PBAnimation'`. */
    readonly className: string;

    constructor (className: string)
    {
        this.className = className;
    }
}

/** @brief Instance variables Ruby adds to strings for their encoding; not interesting. */
const ENCODING_IVARS = new Set(['E', 'encoding']);

/** @brief Reads one Marshal stream. */
class Reader
{
    private pos = 0;
    private readonly symbols: string[] = [];
    private readonly objects: unknown[] = [];
    private readonly text = new TextDecoder('utf-8');
    private readonly buf: Uint8Array;

    constructor (buf: Uint8Array)
    {
        this.buf = buf;
    }

    /** @brief Read the whole stream. */
    read (): unknown
    {
        if (this.buf[0] !== 4 || this.buf[1] !== 8) throw new Error('not a Ruby Marshal 4.8 file');
        this.pos = 2;
        return this.value();
    }

    private byte (): number
    {
        if (this.pos >= this.buf.length) throw new Error('file ends too early');
        return this.buf[this.pos++];
    }

    /** @brief Marshal's packed integer. */
    private int (): number
    {
        const c = (this.byte() << 24) >> 24; // signed
        if (c === 0) return 0;
        if (c >= 5) return c - 5;
        if (c <= -5) return c + 5;
        let n = 0;
        if (c > 0)
        {
            for (let i = 0; i < c; i++) n |= this.byte() << (8 * i);
            return n >>> 0;
        }
        for (let i = 0; i < -c; i++) n |= this.byte() << (8 * i);
        // Negative: the bytes read are the low bytes of a two's complement number.
        return -c >= 4 ? n | 0 : n - 2 ** (8 * -c);
    }

    private bytes (): Uint8Array
    {
        const length = this.int();
        if (this.pos + length > this.buf.length) throw new Error('file ends too early');
        const out = this.buf.subarray(this.pos, this.pos + length);
        this.pos += length;
        return out;
    }

    private symbol (): string
    {
        const type = String.fromCharCode(this.byte());
        if (type === ':')
        {
            const name = this.text.decode(this.bytes());
            this.symbols.push(name);
            return name;
        }
        if (type === ';') return this.symbols[this.int()];
        if (type === 'I')
        {
            // A symbol with an encoding: the encoding ivars follow.
            const name = this.symbol();
            this.ivarsInto(null);
            return name;
        }
        throw new Error(`expected a symbol, found "${type}" at byte ${this.pos - 1}`);
    }

    /** @brief Remember an object for later `@` links; returns it. */
    private entry<T> (value: T): T
    {
        this.objects.push(value);
        return value;
    }

    /** @brief Read `count` instance variables onto an object (or drop them). */
    private ivarsInto (target: unknown): void
    {
        const count = this.int();
        for (let i = 0; i < count; i++)
        {
            const name = this.symbol().replace(/^@/, '');
            const value = this.value();
            if (target instanceof RubyObject && !ENCODING_IVARS.has(name)) target.ivars[name] = value;
        }
    }

    private value (): unknown
    {
        const at = this.pos;
        const type = String.fromCharCode(this.byte());
        switch (type)
        {
            case '0': return null;
            case 'T': return true;
            case 'F': return false;
            case 'i': return this.int();
            case ':': case ';': this.pos--; return this.symbol();
            case '@': return this.objects[this.int()];
            case '"': return this.entry(this.text.decode(this.bytes()));
            case 'f':
            {
                const text = new TextDecoder('latin1').decode(this.bytes());
                const value = text === 'inf' ? Infinity : text === '-inf' ? -Infinity : text === 'nan' ? NaN : parseFloat(text);
                return this.entry(value);
            }
            case 'l':
            {
                const sign = String.fromCharCode(this.byte());
                const words = this.int();
                let n = 0;
                for (let i = 0, scale = 1; i < words * 2; i++, scale *= 256) n += this.byte() * scale;
                return this.entry(sign === '-' ? -n : n);
            }
            case '[':
            {
                const array: unknown[] = this.entry([]);
                const length = this.int();
                for (let i = 0; i < length; i++) array.push(this.value());
                return array;
            }
            case '{': case '}':
            {
                const map = this.entry(new Map<unknown, unknown>());
                const length = this.int();
                for (let i = 0; i < length; i++)
                {
                    const key = this.value();
                    map.set(key, this.value());
                }
                if (type === '}') this.value(); // default value
                return map;
            }
            case 'o':
            {
                const object = this.entry(new RubyObject(this.symbol()));
                this.ivarsInto(object);
                return object;
            }
            case 'I':
            {
                const inner = this.value();
                this.ivarsInto(inner);
                return inner;
            }
            case 'C':
            {
                const object = new RubyObject(this.symbol());
                // The wrapped value is the object Ruby links to; keep the wrapper in its slot.
                const slot = this.objects.length;
                object.value = this.value();
                this.objects[slot] = object;
                return object;
            }
            case 'u':
            {
                const object = new RubyObject(this.symbol());
                object.data = this.bytes();
                return this.entry(object);
            }
            case 'U':
            {
                const object = this.entry(new RubyObject(this.symbol()));
                object.value = this.value();
                return object;
            }
            case 'e':
                this.symbol(); // module the object was extended with
                return this.value();
            case 'S':
            {
                const object = this.entry(new RubyObject(this.symbol()));
                const count = this.int();
                for (let i = 0; i < count; i++) object.ivars[this.symbol()] = this.value();
                return object;
            }
            case '/':
            {
                const source = this.text.decode(this.bytes());
                this.byte(); // options
                return this.entry(source);
            }
            case 'c': case 'm': case 'M':
                return this.entry(this.text.decode(this.bytes()));
            default:
                throw new Error(`unsupported Marshal type "${type}" at byte ${at}`);
        }
    }
}

/**
 * @brief Read a Marshal file (e.g. `PkmnAnimations.rxdata`).
 * @param file File contents.
 * @return The stored value.
 * @throws Error if the file is not Marshal 4.8 data or is cut short.
 */
export function readMarshal (file: Uint8Array): unknown
{
    return new Reader(file).read();
}

/**
 * @brief Read the floats of an RGSS `Color` or `Tone` (`_dump` of four doubles).
 * @param object A `RubyObject` with `data`, or anything else.
 * @return `[red, green, blue, alpha/grey]`, or `null` if `object` is not one.
 */
export function rgssColor (object: unknown): [number, number, number, number] | null
{
    if (!(object instanceof RubyObject) || !object.data || object.data.length < 32) return null;
    const view = new DataView(object.data.buffer, object.data.byteOffset, 32);
    return [0, 1, 2, 3].map((i) => view.getFloat64(i * 8, true)) as [number, number, number, number];
}

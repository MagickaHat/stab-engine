/**
 * @file ValidateMap.js
 * @brief Tiled extension: checks the STAB events on the open map.
 *
 * Adds two actions to the Map menu:
 *
 * - **Validate STAB Map** checks the open map in the editor: every object
 *   with a class has a known class, required properties are set, values
 *   picked from a list (items, species, trainers, scripts, text keys, maps)
 *   exist, objects sit on the tile grid, and Spawn names are unique. It also
 *   runs by itself every time a map is saved.
 * - **Validate STAB Project** runs `node tools/events/validate.ts`, the full
 *   check of every event file and map (the same as `npm run events:validate`).
 *
 * Problems appear in the Issues view; double-click one to select the object.
 *
 * Plain JavaScript run by Tiled's scripting engine, not by the game.
 */

/* global tiled, FileInfo, Process, TextFile */

/**
 * @brief Read the project's property types.
 * @return { classes: { name: members[] }, enums: { name: values[] } }.
 */
function stabReadTypes ()
{
    var classes = {};
    var enums = {};
    try
    {
        var file = new TextFile(tiled.projectFilePath, TextFile.ReadOnly);
        var project = JSON.parse(file.readAll());
        file.close();
        var types = project.propertyTypes || [];
        for (var i = 0; i < types.length; i++)
        {
            if (types[i].type === 'class') classes[types[i].name] = types[i].members || [];
            else if (types[i].type === 'enum') enums[types[i].name] = types[i].values || [];
        }
    }
    catch (e)
    {
        tiled.warn('STAB: could not read the project file (' + e + '). Run npm run events:sync-tiled.');
    }
    return { classes: classes, enums: enums };
}

/** @brief Members that must not be left empty, by class (matches src/events/tiled.ts). */
var STAB_REQUIRED = {
    Event: ['script'], Sign: ['text'], ItemBall: ['item'], HiddenItem: ['item'], Warp: ['map'], Trainer: ['trainer'],
    Trigger: ['script'],
};

/**
 * @brief Every object of every object layer, including inside group layers.
 * @param container A map or group layer.
 * @param out Receives the objects.
 */
function stabCollectObjects (container, out)
{
    for (var i = 0; i < container.layerCount; i++)
    {
        var layer = container.layerAt(i);
        if (layer.isObjectLayer) for (var j = 0; j < layer.objects.length; j++) out.push(layer.objects[j]);
        else if (layer.isGroupLayer) stabCollectObjects(layer, out);
    }
}

/**
 * @brief The plain value of a property (enum values come wrapped).
 * @param value The property value.
 */
function stabPlain (value)
{
    if (value !== null && typeof value === 'object' && value.value !== undefined) return value.value;
    return value;
}

/**
 * @brief Check one map and report problems in the Issues view.
 * @param map The map.
 * @param quiet Do not show a dialog when there are no problems.
 * @return Number of problems.
 */
function stabValidateMap (map, quiet)
{
    if (!map || !map.isTileMap) return 0;
    var types = stabReadTypes();
    var objects = [];
    stabCollectObjects(map, objects);
    var spawns = {};
    var problems = 0;
    var mapName = FileInfo.fileName(map.fileName || 'map');

    function report (object, message, isError)
    {
        problems++;
        var text = 'STAB ' + mapName + ': object ' + object.id + (object.name ? ' "' + object.name + '"' : '') + ': ' + message;
        var select = function ()
        {
            tiled.activeAsset = map;
            map.selectedObjects = [object];
        };
        if (isError) tiled.error(text, select);
        else tiled.warn(text, select);
    }

    for (var i = 0; i < objects.length; i++)
    {
        var object = objects[i];
        var className = object.className || object.type || '';
        if (!className) continue;
        var members = types.classes[className];
        if (!members)
        {
            report(object, 'unknown class "' + className + '" (no factory will create it)', true);
            continue;
        }
        var props = object.resolvedProperties ? object.resolvedProperties() : object.properties();
        for (var m = 0; m < members.length; m++)
        {
            var member = members[m];
            var value = stabPlain(props[member.name]);
            if (value === undefined) value = member.value;
            var required = (STAB_REQUIRED[className] || []).indexOf(member.name) >= 0;
            if (required && (value === '' || value === undefined || value === null))
            {
                report(object, '"' + member.name + '" must be set', true);
                continue;
            }
            var list = member.propertyType && types.enums[member.propertyType];
            if (list && value !== '' && value !== undefined && list.indexOf(String(value)) < 0)
            {
                report(object, '"' + member.name + '": unknown ' + member.propertyType + ' "' + value + '"', true);
            }
        }
        if (object.x % map.tileWidth !== 0 || object.y % map.tileHeight !== 0)
        {
            report(object, 'not aligned to the tile grid', false);
        }
        if (className === 'Spawn')
        {
            if (!object.name) report(object, 'a Spawn needs a name', true);
            else if (spawns[object.name]) report(object, 'two Spawns are named "' + object.name + '"', true);
            spawns[object.name] = true;
        }
        if (className === 'Warp')
        {
            var x = stabPlain(props.x);
            var y = stabPlain(props.y);
            var spawn = stabPlain(props.spawn);
            if ((x === undefined || x < 0 || y === undefined || y < 0) && !spawn) report(object, 'set x and y, or a spawn name', true);
        }
    }
    if (!quiet && problems === 0) tiled.alert('No problems found on ' + mapName + '.');
    return problems;
}

var validateStabMap = tiled.registerAction('ValidateStabMap', function ()
{
    var count = stabValidateMap(tiled.activeAsset, false);
    if (count > 0) tiled.log('STAB: ' + count + ' problem(s) found; see the Issues view.');
});
validateStabMap.text = 'Validate STAB Map';
validateStabMap.shortcut = 'Ctrl+Shift+V';

var validateStabProject = tiled.registerAction('ValidateStabProject', function ()
{
    var root = FileInfo.cleanPath(FileInfo.joinPaths(FileInfo.path(tiled.projectFilePath), '..', '..'));
    var process = new Process();
    process.workingDirectory = root;
    var exit = process.exec('node', ['tools/events/validate.ts']);
    var output = ((process.readStdOut() || '') + '\n' + (process.readStdErr() || '')).split('\n');
    for (var i = 0; i < output.length; i++)
    {
        var line = output[i].trim();
        if (!line) continue;
        if (line.indexOf('✗') === 0) tiled.error('STAB ' + line.slice(1).trim());
        else if (line.indexOf('!') === 0) tiled.warn('STAB ' + line.slice(1).trim());
        else tiled.log(line);
    }
    if (exit === 0) tiled.log('STAB: events and maps are valid.');
});
validateStabProject.text = 'Validate STAB Project';

tiled.extendMenu('Map', [
    { action: 'ValidateStabMap' },
    { action: 'ValidateStabProject' },
]);

//  Check every map when it is saved, quietly.
tiled.assetSaved.connect(function (asset)
{
    if (asset && asset.isTileMap) stabValidateMap(asset, true);
});

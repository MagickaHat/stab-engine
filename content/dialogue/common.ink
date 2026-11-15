// Shared ink code. Pulled into other stories with INCLUDE common.ink.

// Implemented in TypeScript with DialogueEngine.bindFunction('give_item', ...).
// The fallback below is used if the game doesn't bind it (e.g. while testing in Inky).
EXTERNAL give_item(item, amount)
=== function give_item(item, amount) ===
~ return true

=== function plural(word, count) ===
{ count == 1:
    ~ return word
- else:
    ~ return word + "s"
}

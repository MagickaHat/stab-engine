# title: Sample dialogue
# author: STAB-engine

// Example story for the dialogue system (docs/DIALOGUE_SYSTEM.md).
// Import it with: import sample from '../../content/dialogue/sample.ink';

INCLUDE common.ink

VAR player_name = "Player"
VAR potions = 0
VAR met_professor = false

-> professor

=== professor ===
# location: lab
Welcome to the lab, {player_name}! # speaker: Professor # portrait: professor_happy #id:sample.professor.1
~ met_professor = true
Before you set off, take something for the road. # speaker: Professor #id:sample.professor.2
* [Potions, please. # icon: potion #id:sample.professor.3]
    ~ potions = potions + 3
    ~ give_item("potion", 3)
    Here are {potions} {plural("potion", potions)}. # speaker: Professor #id:sample.professor.4
* [I'm fine, thanks. #id:sample.professor.5]
    Brave! Come back if you change your mind. # speaker: Professor #id:sample.professor.6
- -> farewell

= farewell
Good luck out there! # speaker: Professor # portrait: professor_wave #id:sample.professor.farewell.1
-> END

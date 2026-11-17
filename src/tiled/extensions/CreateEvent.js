/**
 * @file CreateEvent.js
 * @brief Tiled extension: places a STAB event object on the current object layer.
 *
 * Adds "Create STAB Event…" to the Map menu (and the object layer's
 * toolbar). A dialog asks for the class (Event, Npc, Sign, ItemBall,
 * HiddenItem, Warp, Trainer, Trigger, Spawn), a name and the tile to put it
 * on. The object is created one tile in size, snapped to the grid, with the
 * class's default properties (from the project's property types, which
 * `npm run events:sync-tiled` writes).
 *
 * For an `Event` or `Trigger` with a script ID that does not exist yet, it
 * can also create the script: it runs CreateEventSource.sh (or .bat on
 * Windows), which adds an empty script to content/events/<map>.json and
 * refreshes the project's Script list.
 *
 * Plain JavaScript run by Tiled's scripting engine, not by the game.
 */

/* global tiled, Dialog, MapObject, Process, FileInfo, TextFile */

var STAB_CLASSES = ['Event', 'Npc', 'Sign', 'ItemBall', 'HiddenItem', 'Warp', 'Trainer', 'Trigger', 'Spawn'];

/**
 * @brief Read the project's property types (classes and enums).
 * @return Array of property types, or an empty array.
 */
function stabProjectTypes ()
{
    try
    {
        var file = new TextFile(tiled.projectFilePath, TextFile.ReadOnly);
        var project = JSON.parse(file.readAll());
        file.close();
        return project.propertyTypes || [];
    }
    catch (e)
    {
        return [];
    }
}

/**
 * @brief The object layer to put the event on: the current layer, or the first object layer.
 * @param map The map.
 * @return The layer, or null.
 */
function stabTargetLayer (map)
{
    if (map.currentLayer && map.currentLayer.isObjectLayer) return map.currentLayer;
    for (var i = 0; i < map.layerCount; i++)
    {
        var layer = map.layerAt(i);
        if (layer.isObjectLayer) return layer;
    }
    return null;
}

/**
 * @brief Run CreateEventSource to add an empty script to content/events.
 * @param scriptId The script ID.
 * @param fileName Event file name (usually the map's name).
 * @return true if it worked.
 */
function stabCreateScript (scriptId, fileName)
{
    var extensions = FileInfo.joinPaths(FileInfo.path(tiled.projectFilePath), 'extensions');
    var windows = tiled.platform === 'windows';
    var process = new Process();
    var exit = windows
        ? process.exec('cmd.exe', ['/c', FileInfo.joinPaths(extensions, 'CreateEventSource.bat'), scriptId, fileName])
        : process.exec('sh', [FileInfo.joinPaths(extensions, 'CreateEventSource.sh'), scriptId, fileName]);
    var output = (process.readStdOut() || '') + (process.readStdErr() || '');
    if (exit !== 0)
    {
        tiled.alert('Could not create the script:\n\n' + output);
        return false;
    }
    tiled.log(output);
    return true;
}

var createStabEvent = tiled.registerAction('CreateStabEvent', function ()
{
    var map = tiled.activeAsset;
    if (!map || !map.isTileMap)
    {
        tiled.alert('Open a map first.');
        return;
    }
    var layer = stabTargetLayer(map);
    if (!layer)
    {
        tiled.alert('The map has no object layer. Add one (Layer > New > Object Layer) for events.');
        return;
    }

    //  Start next to the first selected object, or in the middle of the map.
    var startX = Math.floor(map.width / 2);
    var startY = Math.floor(map.height / 2);
    if (map.selectedObjects.length > 0)
    {
        startX = Math.floor(map.selectedObjects[0].x / map.tileWidth) + 1;
        startY = Math.floor(map.selectedObjects[0].y / map.tileHeight);
    }

    var dialog = new Dialog('Create STAB Event');
    var classBox = dialog.addComboBox('Class:', STAB_CLASSES);
    dialog.addNewRow();
    var nameInput = dialog.addTextInput('Name:', '');
    dialog.addNewRow();
    var xInput = dialog.addNumberInput('Tile X:');
    xInput.decimals = 0;
    xInput.minimum = 0;
    xInput.maximum = map.width - 1;
    xInput.value = Math.min(startX, map.width - 1);
    var yInput = dialog.addNumberInput('Tile Y:');
    yInput.decimals = 0;
    yInput.minimum = 0;
    yInput.maximum = map.height - 1;
    yInput.value = Math.min(startY, map.height - 1);
    dialog.addNewRow();
    var scriptInput = dialog.addTextInput('Script ID (Event/Trigger):', '');
    dialog.addNewRow();
    var createScript = dialog.addCheckBox('Create the script if it does not exist', true);
    dialog.addNewRow();
    var ok = dialog.addButton('Create');
    var cancel = dialog.addButton('Cancel');
    ok.clicked.connect(function () { dialog.accept(); });
    cancel.clicked.connect(function () { dialog.reject(); });
    if (dialog.exec() !== Dialog.Accepted) return;

    var className = STAB_CLASSES[classBox.currentIndex];
    var name = nameInput.text.trim();
    if (className === 'Spawn' && !name)
    {
        tiled.alert('A Spawn needs a name: warps arrive at it by name.');
        return;
    }

    var scriptId = scriptInput.text.trim();
    if (scriptId && (className === 'Event' || className === 'Trigger'))
    {
        var known = false;
        var types = stabProjectTypes();
        for (var i = 0; i < types.length; i++)
        {
            if (types[i].name === 'Script' && types[i].values.indexOf(scriptId) >= 0) known = true;
        }
        if (!known && createScript.checked)
        {
            var mapName = FileInfo.baseName(map.fileName || 'untitled');
            if (!stabCreateScript(scriptId, mapName)) return;
            tiled.log('Created script "' + scriptId + '". Reload the project (Project > Reload) to see it in the Script list.');
        }
    }

    var object = new MapObject(name);
    object.className = className;
    object.x = xInput.value * map.tileWidth;
    object.y = yInput.value * map.tileHeight;
    object.width = map.tileWidth;
    object.height = map.tileHeight;

    map.macro('Create STAB Event', function ()
    {
        layer.addObject(object);
        if (scriptId && (className === 'Event' || className === 'Trigger'))
        {
            object.setProperty('script', tiled.propertyValue('Script', scriptId));
        }
    });
    map.selectedObjects = [object];
});
createStabEvent.text = 'Create STAB Event…';
createStabEvent.icon = 'ext:CreateEvent.png';
createStabEvent.shortcut = 'Ctrl+Shift+E';

tiled.extendMenu('Map', [
    { separator: true },
    { action: 'CreateStabEvent' },
]);

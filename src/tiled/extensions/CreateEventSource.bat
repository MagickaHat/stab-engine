@echo off
rem Adds an empty event script to content/events and refreshes the Tiled project.
rem Called by CreateEvent.js; can also be run by hand:
rem   src\tiled\extensions\CreateEventSource.bat ^<script id^> [event file]
cd /d "%~dp0..\..\.."
node tools\events\new-script.ts %*

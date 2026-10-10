*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/backup.resource

*** Test Cases ***
Greeting Works
    Greet    world

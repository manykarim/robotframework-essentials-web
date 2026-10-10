*** Settings ***
Resource    ../resources/common.resource

*** Test Cases ***
Greeting Works
    Greet    world

Arithmetic Holds
    Sum Should Be    2    3    5

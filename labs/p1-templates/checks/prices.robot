*** Settings ***
Documentation    Four near-identical tests, begging to be one template.

*** Test Cases ***
Backpack Price Is Right
    Should Be Equal As Numbers    79.00    79.00

Lamp Price Is Right
    Should Be Equal As Numbers    34.50    34.50

Mug Price Is Right
    Should Be Equal As Numbers    19.90    19.90

Notebook Price Is Right
    Should Be Equal As Numbers    12.00    12.00

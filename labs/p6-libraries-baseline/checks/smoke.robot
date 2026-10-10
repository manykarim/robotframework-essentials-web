*** Settings ***
Library    Collections

*** Test Cases ***
Environment Is Ready
    ${tools}=    Create List    library    listener    modifier
    Length Should Be    ${tools}    3

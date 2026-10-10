*** Keywords ***
Greet
    [Documentation]    Log a friendly greeting.
    [Arguments]    ${name}
    Log    Hello, ${name}!

Sum Should Be
    [Arguments]    ${a}    ${b}    ${expected}
    ${sum}=    Evaluate    ${a} + ${b}
    Should Be Equal As Integers    ${sum}    ${expected}

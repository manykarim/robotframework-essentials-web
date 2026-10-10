*** Settings ***
Library     RequestsLibrary
Resource    ../resources/api.resource

*** Test Cases ***
Api Is Healthy
    ${resp}=    GET    ${API_URL}/api/health
    Status Should Be    200    ${resp}
    Should Be Equal    ${resp.json()}[status]    ok

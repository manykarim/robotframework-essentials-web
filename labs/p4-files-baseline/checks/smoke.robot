*** Settings ***
Library    OperatingSystem

*** Test Cases ***
Sample Data Is Present
    File Should Exist    sample_data/catalog.xml
    Directory Should Exist    sample_data

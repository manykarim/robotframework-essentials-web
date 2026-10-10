*** Settings ***
Library     Browser
Resource    ../resources/shop.resource

*** Test Cases ***
Login Page Loads
    New Browser    chromium    headless=True
    New Context
    New Page    ${BASE_URL}/login
    Get Title    ==    Sign in — RF Demo Shop
    Close Browser

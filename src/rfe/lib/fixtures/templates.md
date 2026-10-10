# Templates

When several tests do the same thing with different data, a **template**
collapses them into one keyword run once per row. You set `Test Template` in
`*** Settings ***`, name the columns after the test-case header, and list one
data row per test.

This chapter's workspace has `checks/prices.robot` — four near-identical price
tests. Initialize the chapter, then rewrite it as one template with four rows.

## Task 1 — Collapse the repetitive suite into one template

**Goal:** rewrite `checks/prices.robot` as a single template that runs one
keyword per product, checking each price is positive.

Here is the same idea over different data — a template that checks a couple of
people are adults. Adapt its shape; don't copy it.

<!-- example -->
```robotframework
*** Settings ***
Test Template    Age Is Adult

*** Test Cases ***    NAME     AGE
Ada                   Ada      31
Grace                 Grace    45

*** Keywords ***
Age Is Adult
    [Arguments]    ${name}    ${age}
    Should Be True    ${age} >= 18
```
<!-- /example -->

Now do the same for prices in `checks/prices.robot`:

1. Set a `Test Template` in `*** Settings ***`.
2. Name the columns after the `*** Test Cases ***` header, one row per product.
3. Define the template keyword with `[Arguments]` for the product and its price.

**Check:** the tests in `checks/prices.robot` use a template, and all four pass.

<!-- hint -->
Set `Test Template    Price Should Be Positive` in the `*** Settings ***`
section — it applies to every test in the suite.
<!-- /hint -->
<!-- hint -->
Under `*** Test Cases ***`, write the column header (e.g. `PRODUCT    PRICE`),
then one row per product: a test name, the slug, and the price.
<!-- /hint -->
<!-- hint -->
Define the keyword `Price Should Be Positive` with
`[Arguments]    ${product}    ${price}` and assert `Should Be True    ${price} > 0`.
<!-- /hint -->
<!-- solution -->
```robotframework
*** Settings ***
Documentation    Prices, checked with one template.
Test Template    Price Should Be Positive

*** Test Cases ***    PRODUCT      PRICE
Backpack              backpack     79.00
Lamp                  lamp         34.50
Mug                   mug          19.90
Notebook              notebook     12.00

*** Keywords ***
Price Should Be Positive
    [Arguments]    ${product}    ${price}
    Should Be True    ${price} > 0
```
<!-- /solution -->

## Task 2 — Run the templated tests green

Run it:

```bash
uv run robot checks
```

Four tests run, one per row.

**Check:** all four templated tests pass.

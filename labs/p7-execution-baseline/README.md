# rf-essentials — Hooking into Execution

The suite you observe is `checks/orders.robot`; a CSV source for the parser
lesson is in `data/orders.csv`. Your execution extensions go in `ext/`.

- Run with a listener:   `uv run robot --listener ext/<File>.py checks/orders.robot`
- Reprocess results:     `uv run rebot --prerebotmodifier ext/<File>.py results/output.xml`

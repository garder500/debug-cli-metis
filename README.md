# debug-cli

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Remote shopping:

```bash
bun run index.ts remote shopping --payload examples/remote-shopping-payload.sample.json
```

Remote shopping interactif:

```bash
bun run index.ts remote interactive
# ou
bun run index.ts interactive remote
```

Custom URL / output size:

```bash
bun run index.ts remote shopping \
  --payload C:/Users/user/Downloads/shopping-payload.json \
  --url http://localhost:3000/aerial/global/airShoppingRQ \
  --max 40
```

This project was created using `bun init` in bun v1.3.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

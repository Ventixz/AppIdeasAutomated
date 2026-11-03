# Flower Shop — Ordering To Go

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 9 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a flower shop application which deals in
flower objects…"* — a shop that sells single flowers and arrangements of them,
tracks its stock, and takes orders "to go".

Like every task in this category, the point is the **design**, not how many
flowers are in the catalogue. The naive version is a cart that loops over items
with a `if (item.type === 'bouquet')` branch, adds up `price` floats, and
decrements a `stock` dictionary as it goes — and it gets three things wrong, each
one about *where behaviour and invariants should live*.

## The design in three ideas

### 1. A flower and a bouquet are the *same kind of thing* (Composite)

`Saleable` is genuinely abstract — constructing one throws. It promises exactly
two things: `price()` (what it costs) and `stems()` (which flowers, and how many,
it pulls from inventory). `Flower` is the **leaf** — one stem, priced per stem.
`Bouquet` is the **composite** — a list of saleables with an arrangement fee and
an optional discount.

The trap is the `if (item.type === 'bouquet') … else …` branch that reappears
everywhere you touch an item. Here **nothing** switches on which kind a line is:
the cart totals by calling `item.price()`, the shop checks stock by calling
`item.stems()`. Because a bouquet's items are themselves `Saleable`, a bouquet
can *contain another bouquet* — the "Anniversary Grand" wraps the whole "Dozen
Red Roses" bouquet plus more flowers, and its price and 29-stem demand fall out
of the same two recursive methods. Adding gift baskets tomorrow is **one new
subclass** and zero edits anywhere else — the Open/Closed principle you can see.

### 2. Money is an *exact value*, not a float

`0.1 + 0.2 !== 0.3`, and a price printed as `$41.000000003` is a bug waiting to
happen. So money never flows through a float: the `Money` value object stores an
**integer number of cents**, and all arithmetic is integer arithmetic.

- `$2.50 + 3 × $0.10` is exactly `$2.80`;
- a dozen roses — `12 × $2.50 + 6 × $0.60` baby's breath `+ $4.00` arrangement,
  then **10% off** — is exactly **`$33.84`**, and the saving is exactly `$3.76`.

A percentage discount is the *one* place rounding is unavoidable, so `Money`
rounds it **half-up to the cent explicitly** rather than letting a float decide.
`Money` is immutable and frozen, so a price can't be mutated out from under you.

### 3. An order is a *transaction* — atomic, or not at all

The worst bug in a shop is a half-finished sale: you charged the customer, pulled
six roses, then discovered you were two lilies short and left the shelves and the
till inconsistent. So the `Shop` owns the invariant — **stock is never negative,
and the register and the shelves always agree** — and an order is atomic:

- `checkout(cart)` first totals the **entire** stem demand and checks every
  flower up front;
- if even one stem is short, it throws `OutOfStockError` (carrying the exact
  shortfalls) and **nothing mutates** — no decrement, no charge;
- only once the whole order is known to be fulfillable does anything change.

A test pins this: a refused order leaves stock and register byte-for-byte as they
were. Inventory can only be reached *through* the shop's methods, so no caller can
drive it negative. `lowStock()` reports which flowers have fallen to their reorder
level — the "time to buy more" list.

## Running it

**The browser demo** — open `index.html`. Click flowers and bouquets onto your
order, watch the running total, and check out: a successful sale prints a receipt
and decrements exactly the stems used; an impossible one is refused in full, with
the shortfall shown and the shelves untouched.

**The CLI** (same classes, no dependencies):

```sh
node flower-node.js                     # the shop: menu + inventory
node flower-node.js --menu              # flowers and bouquets with prices
node flower-node.js --stock             # inventory, low stock flagged
node flower-node.js order "Spring Mix"  # buy one, print the receipt
node flower-node.js order Rose 10       # buy 10 red-rose stems
node flower-node.js --repl              # interactive

# pipe ';'-separated commands:
echo "cart Spring Mix; cart Rose 6; checkout" | node flower-node.js
```

REPL / stdin commands: `menu`, `stock`, `cart <name> [qty]`, `cart` (show),
`checkout`, `order <name> [qty]`, `register`, `reset`, `json`, `help`, `quit`.
A trailing number is the quantity; everything before it is the (multi-word) name.

**The tests:**

```sh
node tests.js        # 53 dependency-free assertions, exit code 0 on success
```

They lean on the guarantees, not the surface: money is exact (`$2.50 + 3×$0.10 =
$2.80`, a discount rounds half-up), a bouquet prices and counts stems by
recursion (two levels deep), a cart mixes flowers and bouquets without branching,
an over-order throws and leaves inventory **untouched** (the atomicity test), a
fulfillable order decrements exactly the stems used and credits exactly the
price, and invalid things (abstract `Saleable`, negative price, empty bouquet,
unknown flower, non-whole quantities) are refused.

## Files

| File | What's in it |
| --- | --- |
| `flower-core.js` | the engine: `Saleable` (abstract) + `Flower` (leaf) and `Bouquet` (composite), the `Money` value object, `Cart`, `Receipt`, and `Shop` (the atomic inventory + register) |
| `flower-fixtures.js` | the sample shop (6 flowers, 3 bouquets incl. a nested one) shared by the CLI, tests and browser |
| `flower-node.js` | the CLI / REPL over the same classes |
| `tests.js` | dependency-free assertions |
| `index.html`, `style.css`, `script.js` | the browser demo (all pricing and inventory live in the core; this only paints) |

---

*This project is one entry in a daily automated series. A [Claude Code](https://claude.com/claude-code)
routine builds one project from a public project list each day, writes it up, and
merges it. See the repository root `README.md` and `PROGRESS.md` for the full run.*

# Hello

A mock login screen that, on a successful "log in", greets you with the word
**"hello" in your own native language** — detected from your location — and
personalises the message with your username.

Source idea: [app-ideas / Hello-App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Hello-App.md)

## Features

- **Mock login panel** with a username and a masked password field.
- **Validation** — empty fields get a red border and an inline error message,
  and the error clears as soon as you start typing.
- **Native-language greeting** — on success the page shows
  `<hello-in-native-language> <user-name> you have successfully logged in!`,
  e.g. *"Bonjour ada you have successfully logged in!"* for a visitor in France.
- **Logout** — clears all fields, returns to the login panel and shows
  `Have a great day <user-name>!`.

## Bonus features implemented

- **Language code override** — an "Advanced" field lets you force a language
  (`fr`, `es`, `ja`, …) so you can test greetings from anywhere.
- **Geolocation details** — after login the page lists the detected IP, city,
  region, country, ZIP, coordinates and timezone.

## HTML-entity decoding

The spec requires decoding the greeting because the HelloSalut API returns it
with HTML entities. We decode by round-tripping the string through a detached
`<textarea>`, which lets the browser do the parsing without any dependency:

```js
function decodeHtmlEntities(str) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}
```

## A note on the APIs

The original spec names **ip-api** for the IP/geolocation and **Fourtonfish**
for the greeting.

- **Greeting:** [Fourtonfish HelloSalut](https://fourtonfish.com/hellosalut/) is
  used exactly as specified. With `?ip=auto` it infers the language from the
  caller's IP; with `?lang=xx` it returns a specific language (used by the
  override field).
- **Geolocation:** ip-api's free tier only serves plain **HTTP**, which a
  browser blocks from an HTTPS page (mixed content). [ipapi.co](https://ipapi.co)
  is the CORS-enabled, HTTPS-native equivalent, so it keeps this project a
  single static page with no proxy or build step — consistent with the rest of
  the repo.

## Run it

Open `index.html` in any browser — no build step or dependencies. A network
connection is required so it can reach the greeting and geolocation APIs.

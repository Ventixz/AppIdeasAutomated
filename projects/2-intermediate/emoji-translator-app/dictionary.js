/* Emoji dictionaries, one per input language.
 *
 * Each entry maps an emoji to the list of words (synonyms) that translate to
 * it. Listing several words per emoji is how the "Emoji Synonyms" bonus is met
 * — e.g. "happy", "glad" and "joy" all become 😊. `buildLookup` below flattens
 * these into a fast word → emoji map, lower-cased so matching is case
 * insensitive. */

const EMOJI_LANGUAGES = {
  en: {
    label: "English",
    entries: {
      "😊": ["happy", "glad", "joy", "joyful"],
      "😢": ["sad", "unhappy", "cry", "crying"],
      "😂": ["laugh", "laughing", "lol", "haha"],
      "😍": ["love", "adore", "loving"],
      "😡": ["angry", "mad", "furious"],
      "😴": ["sleep", "sleepy", "tired", "sleeping"],
      "🍕": ["pizza"],
      "🍔": ["burger", "hamburger"],
      "🍎": ["apple"],
      "🍌": ["banana"],
      "☕": ["coffee"],
      "🍺": ["beer"],
      "🐶": ["dog", "puppy", "doggo"],
      "🐱": ["cat", "kitten", "kitty"],
      "🦊": ["fox"],
      "🐍": ["snake"],
      "☀️": ["sun", "sunny"],
      "🌧️": ["rain", "rainy", "raining"],
      "❄️": ["snow", "snowy", "cold"],
      "🔥": ["fire", "hot", "lit"],
      "❤️": ["heart"],
      "⭐": ["star"],
      "🏠": ["home", "house"],
      "🚗": ["car"],
      "✈️": ["plane", "airplane", "flight"],
      "💰": ["money", "cash"],
      "💻": ["computer", "laptop", "code", "coding"],
      "📱": ["phone", "mobile", "smartphone"],
      "🎵": ["music", "song", "melody"],
      "📚": ["book", "books", "reading"],
      "⚽": ["soccer", "football"],
      "🎉": ["party", "celebrate", "celebration"],
      "👍": ["yes", "ok", "okay", "good", "great"],
      "👎": ["no", "bad", "nope"],
      "🌍": ["world", "earth", "planet"],
      "🕐": ["time", "clock"],
    },
  },

  es: {
    label: "Español",
    entries: {
      "😊": ["feliz", "contento", "alegre"],
      "😢": ["triste", "llorar"],
      "😂": ["reir", "risa"],
      "😍": ["amor", "amar"],
      "😡": ["enojado", "furioso"],
      "😴": ["dormir", "cansado", "suenno"],
      "🍕": ["pizza"],
      "🍎": ["manzana"],
      "🍌": ["platano", "banana"],
      "☕": ["cafe"],
      "🐶": ["perro", "perrito"],
      "🐱": ["gato", "gatito"],
      "☀️": ["sol", "soleado"],
      "🌧️": ["lluvia", "lloviendo"],
      "🔥": ["fuego", "caliente"],
      "❤️": ["corazon"],
      "⭐": ["estrella"],
      "🏠": ["casa", "hogar"],
      "🚗": ["coche", "carro", "auto"],
      "💰": ["dinero"],
      "🌍": ["mundo", "tierra"],
    },
  },

  fr: {
    label: "Français",
    entries: {
      "😊": ["heureux", "content", "joyeux"],
      "😢": ["triste", "pleurer"],
      "😂": ["rire"],
      "😍": ["amour", "aimer"],
      "😡": ["colere", "fache"],
      "😴": ["dormir", "fatigue"],
      "🍕": ["pizza"],
      "🍎": ["pomme"],
      "🍌": ["banane"],
      "☕": ["cafe"],
      "🐶": ["chien", "chiot"],
      "🐱": ["chat", "chaton"],
      "☀️": ["soleil", "ensoleille"],
      "🌧️": ["pluie", "pluvieux"],
      "🔥": ["feu", "chaud"],
      "❤️": ["coeur"],
      "⭐": ["etoile"],
      "🏠": ["maison"],
      "🚗": ["voiture"],
      "💰": ["argent"],
      "🌍": ["monde", "terre"],
    },
  },
};

/* Flatten a language's { emoji: [words] } entries into a { word: emoji } map. */
function buildLookup(languageKey) {
  const lang = EMOJI_LANGUAGES[languageKey];
  const lookup = {};
  for (const [emoji, words] of Object.entries(lang.entries)) {
    for (const word of words) {
      lookup[word.toLowerCase()] = emoji;
    }
  }
  return lookup;
}

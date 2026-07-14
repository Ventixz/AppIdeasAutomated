"use strict";

/*
 * Sample charity directory.
 *
 * The app-ideas spec builds around the GlobalGiving API, which requires a
 * private API key and returns XML — neither of which fits this repo's
 * "open index.html, no build, no secrets" routine. So the app ships with this
 * curated set of *real* organizations, shaped like the fields the GlobalGiving
 * API exposes (id, name, address, logo, home country, countries served,
 * themes, mission, website, and a representative project).
 *
 * Every logo is an inline SVG data URI, so cards render fully offline with no
 * third-party image requests.
 */

function logo(bg, initials) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">` +
    `<rect width="120" height="120" rx="18" fill="${bg}"/>` +
    `<text x="60" y="60" font-family="Arial, sans-serif" font-size="46" ` +
    `font-weight="700" fill="#ffffff" text-anchor="middle" ` +
    `dominant-baseline="central">${initials}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const CHARITIES = [
  {
    id: 4438,
    name: "charity: water",
    address: "40 Worth St, Suite 330, New York, NY 10013, USA",
    home: "United States",
    serves: ["Ethiopia", "Uganda", "India", "Nepal", "Rwanda"],
    themes: ["Water & Sanitation", "Health"],
    mission:
      "Bringing clean and safe drinking water to people in developing countries — 100% of public donations fund water projects.",
    website: "https://www.charitywater.org/",
    logo: logo("#0891b2", "cw"),
    project: {
      title: "Clean water for 10 villages in Ethiopia",
      goal: 500000,
      raised: 412300,
      summary:
        "Drilling boreholes and building spring protections to serve rural communities in the Tigray region.",
    },
  },
  {
    id: 3021,
    name: "Doctors Without Borders",
    address: "40 Rue Rebeval, 75019 Paris, France",
    home: "France",
    serves: ["Yemen", "South Sudan", "Syria", "Bangladesh", "Haiti"],
    themes: ["Health", "Disaster Response"],
    mission:
      "Delivering emergency medical care to people affected by conflict, epidemics, disasters, and exclusion from healthcare.",
    website: "https://www.doctorswithoutborders.org/",
    logo: logo("#dc2626", "❤"),
    project: {
      title: "Mobile clinics for displaced families",
      goal: 800000,
      raised: 655000,
      summary:
        "Staffing mobile health units delivering maternal care and vaccinations in crisis zones.",
    },
  },
  {
    id: 5519,
    name: "Room to Read",
    address: "465 California St, Suite 1000, San Francisco, CA 94104, USA",
    home: "United States",
    serves: ["India", "Nepal", "Cambodia", "Vietnam", "Tanzania"],
    themes: ["Education", "Gender Equality"],
    mission:
      "Creating a world free from illiteracy and gender inequality through literacy and girls' education programs.",
    website: "https://www.roomtoread.org/",
    logo: logo("#7c3aed", "R2"),
    project: {
      title: "Girls' education program in Nepal",
      goal: 300000,
      raised: 208900,
      summary:
        "Mentorship, life-skills workshops, and material support keeping girls in secondary school.",
    },
  },
  {
    id: 6210,
    name: "The Ocean Cleanup",
    address: "Coolsingel 6, 3011 AD Rotterdam, Netherlands",
    home: "Netherlands",
    serves: ["Netherlands", "United States", "Indonesia", "Global"],
    themes: ["Environment", "Climate"],
    mission:
      "Developing advanced technologies to rid the world's oceans and rivers of plastic.",
    website: "https://theoceancleanup.com/",
    logo: logo("#0284c7", "OC"),
    project: {
      title: "Interceptor deployment in Southeast Asia",
      goal: 1200000,
      raised: 940500,
      summary:
        "Installing river Interceptors to stop plastic before it reaches the ocean.",
    },
  },
  {
    id: 1187,
    name: "GiveDirectly",
    address: "114 W 41st St, New York, NY 10036, USA",
    home: "United States",
    serves: ["Kenya", "Uganda", "Rwanda", "Malawi", "Morocco"],
    themes: ["Economic Development", "Poverty"],
    mission:
      "Sending money directly to people living in poverty, letting recipients decide how best to improve their lives.",
    website: "https://www.givedirectly.org/",
    logo: logo("#16a34a", "GD"),
    project: {
      title: "Basic income for rural households",
      goal: 600000,
      raised: 523400,
      summary:
        "Unconditional cash transfers to extremely poor households across East Africa.",
    },
  },
  {
    id: 8843,
    name: "World Wildlife Fund",
    address: "1250 24th St NW, Washington, DC 20037, USA",
    home: "United States",
    serves: ["Brazil", "Indonesia", "Kenya", "Nepal", "Global"],
    themes: ["Environment", "Animals"],
    mission:
      "Conserving nature and reducing the most pressing threats to the diversity of life on Earth.",
    website: "https://www.worldwildlife.org/",
    logo: logo("#166534", "🐼"),
    project: {
      title: "Protecting tiger habitats in Nepal",
      goal: 450000,
      raised: 301200,
      summary:
        "Anti-poaching patrols and habitat corridors to double the wild tiger population.",
    },
  },
  {
    id: 2094,
    name: "Akshaya Patra Foundation",
    address: "Hare Krishna Hill, Rajajinagar, Bengaluru 560010, India",
    home: "India",
    serves: ["India"],
    themes: ["Hunger", "Education", "Health"],
    mission:
      "Eliminating classroom hunger by serving freshly cooked midday meals to schoolchildren across India.",
    website: "https://www.akshayapatra.org/",
    logo: logo("#ea580c", "AP"),
    project: {
      title: "One million school meals",
      goal: 250000,
      raised: 178650,
      summary:
        "Scaling kitchen capacity to serve nutritious lunches that keep children in school.",
    },
  },
  {
    id: 7712,
    name: "Barefoot College",
    address: "Tilonia, Madanganj, Rajasthan 305816, India",
    home: "India",
    serves: ["India", "Tanzania", "Senegal", "Guatemala", "Fiji"],
    themes: ["Education", "Environment", "Gender Equality"],
    mission:
      "Training rural women as solar engineers to bring clean energy and self-reliance to their villages.",
    website: "https://www.barefootcollege.org/",
    logo: logo("#ca8a04", "BC"),
    project: {
      title: "Solar Mamas engineering cohort",
      goal: 200000,
      raised: 96400,
      summary:
        "A six-month residential program teaching illiterate grandmothers to build and repair solar units.",
    },
  },
  {
    id: 3356,
    name: "Mercy Corps",
    address: "45 SW Ankeny St, Portland, OR 97204, USA",
    home: "United States",
    serves: ["Jordan", "Nigeria", "Somalia", "Ukraine", "Guatemala"],
    themes: ["Disaster Response", "Economic Development", "Hunger"],
    mission:
      "Helping people in the world's toughest places turn crisis into opportunity and build stronger communities.",
    website: "https://www.mercycorps.org/",
    logo: logo("#be185d", "MC"),
    project: {
      title: "Emergency food and cash in Ukraine",
      goal: 900000,
      raised: 712800,
      summary:
        "Rapid cash assistance and food distribution for families displaced by conflict.",
    },
  },
  {
    id: 9905,
    name: "Sightsavers",
    address: "35 Perrymount Rd, Haywards Heath RH16 3BW, United Kingdom",
    home: "United Kingdom",
    serves: ["Nigeria", "Kenya", "India", "Bangladesh", "Zambia"],
    themes: ["Health", "Disability"],
    mission:
      "Working to prevent avoidable blindness and to promote equality for people with disabilities.",
    website: "https://www.sightsavers.org/",
    logo: logo("#4338ca", "SS"),
    project: {
      title: "Cataract surgeries in rural Nigeria",
      goal: 350000,
      raised: 240100,
      summary:
        "Funding surgeries and eye clinics that restore sight for a few dollars per patient.",
    },
  },
  {
    id: 6634,
    name: "Amnesty International",
    address: "1 Easton St, London WC1X 0DW, United Kingdom",
    home: "United Kingdom",
    serves: ["Global"],
    themes: ["Human Rights", "Gender Equality"],
    mission:
      "Campaigning for a world where human rights are enjoyed by everyone, everywhere.",
    website: "https://www.amnesty.org/",
    logo: logo("#f59e0b", "AI"),
    project: {
      title: "Human rights defenders at risk",
      goal: 400000,
      raised: 156700,
      summary:
        "Legal aid and protection for activists facing persecution around the world.",
    },
  },
  {
    id: 4471,
    name: "Wildlife Conservation Kenya",
    address: "Langata Rd, Nairobi, Kenya",
    home: "Kenya",
    serves: ["Kenya", "Tanzania"],
    themes: ["Animals", "Environment"],
    mission:
      "Protecting East Africa's wildlife and wild lands through community-led conservation.",
    website: "https://www.globalgiving.org/",
    logo: logo("#0d9488", "🦁"),
    project: {
      title: "Community ranger training",
      goal: 180000,
      raised: 64200,
      summary:
        "Equipping and training local rangers to protect elephants and rhinos from poaching.",
    },
  },
];

// expose for script.js (plain <script> tags, no modules)
window.CHARITIES = CHARITIES;

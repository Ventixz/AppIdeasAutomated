// Hardcoded test data, as the spec calls for.
const people = [
  {
    name: 'Ada Lovelace',
    address: '12 Analytical Way, London',
    phone: '+44 20 7946 0001',
    birthday: 'December 10, 1815',
  },
  {
    name: 'Grace Hopper',
    address: '47 Compiler Court, New York, NY',
    phone: '+1 (212) 555-0147',
    birthday: 'December 9, 1906',
  },
  {
    name: 'Alan Turing',
    address: '5 Enigma Road, Manchester',
    phone: '+44 161 496 0023',
    birthday: 'June 23, 1912',
  },
  {
    name: 'Katherine Johnson',
    address: '88 Orbit Lane, Hampton, VA',
    phone: '+1 (757) 555-0192',
    birthday: 'August 26, 1918',
  },
  {
    name: 'Dennis Ritchie',
    address: '3 Pointer Place, Murray Hill, NJ',
    phone: '+1 (908) 555-0173',
    birthday: 'September 9, 1941',
  },
  {
    name: 'Margaret Hamilton',
    address: '21 Apollo Avenue, Boston, MA',
    phone: '+1 (617) 555-0158',
    birthday: 'August 17, 1936',
  },
];

const summary = document.getElementById('summary');
const detail = document.getElementById('detail');

let selectedItem = null;

/** Render the chosen person's details into the adjacent pane. */
function showDetail(person) {
  detail.innerHTML = `
    <h2>${person.name}</h2>
    <dl>
      <dt>Address</dt><dd>${person.address}</dd>
      <dt>Telephone</dt><dd>${person.phone}</dd>
      <dt>Birthday</dt><dd>${person.birthday}</dd>
    </dl>
  `;
}

/** Move the selection effect from the previous item to the clicked one. */
function select(item, person) {
  if (selectedItem) selectedItem.classList.remove('selected');
  item.classList.add('selected');
  selectedItem = item;
  showDetail(person);
}

// Build the summary list of names.
people.forEach((person) => {
  const item = document.createElement('li');
  item.textContent = person.name;
  item.setAttribute('role', 'option');
  item.addEventListener('click', () => select(item, person));
  summary.appendChild(item);
});

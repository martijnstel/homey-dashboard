const OPSLAG = 'huis-dashboard';
const APP_ID = 'nl.martijnstel.automationcore';
const VERVERS_MS = 5000;
// Vingerafdruk (SHA-256) van de hostnaam van de eigen Homey. Het adres zelf staat bewust niet in
// deze openbare pagina; uit de vingerafdruk is het niet terug te rekenen.
const HOMEY_VINGERAFDRUK = 'c20d2d6b26e241f18668a6d1addd5991d4939cc51b4720fff8cbb651215dcf93';

let instellingen = null;
let timer = null;
let bezigMetSlepen = false;

/* ---------- instellingen ---------- */

function laadInstellingen() {
  try {
    const ruw = localStorage.getItem(OPSLAG);
    return ruw ? JSON.parse(ruw) : null;
  } catch (fout) {
    return null;
  }
}

function isHomeyAdres(adres) {
  try {
    const url = new URL(adres);

    return url.protocol === 'https:'
      && url.hostname.endsWith('.homeypro.net')
      && !url.username && !url.password
      && (url.pathname === '/' || url.pathname === '')
      && !url.search && !url.hash;
  } catch (fout) {
    return false;
  }
}

async function vingerafdruk(tekst) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tekst));

  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Alleen de eigen Homey: een echt Homey-adres van iemand anders wordt ook geweigerd.
async function isEigenHomey(adres) {
  if (!isHomeyAdres(adres)) {
    return false;
  }

  return (await vingerafdruk(new URL(adres).hostname.toLowerCase())) === HOMEY_VINGERAFDRUK;
}

function toonInstelscherm(bestaand) {
  document.getElementById('dashboard').hidden = true;
  document.getElementById('instellen').hidden = false;
  document.getElementById('opnieuw-instellen').hidden = true;

  if (bestaand && bestaand.adres) {
    document.getElementById('adres').value = bestaand.adres;
  }
}

function toonDashboard() {
  document.getElementById('instellen').hidden = true;
  document.getElementById('dashboard').hidden = false;
  document.getElementById('opnieuw-instellen').hidden = false;
}

document.getElementById('bewaar').addEventListener('click', async () => {
  const adres = document.getElementById('adres').value.trim().replace(/\/+$/, '');
  const sleutel = document.getElementById('sleutel').value.trim();
  const fout = document.getElementById('instelfout');

  // Alleen een Homey-cloudadres: zo kan de sleutel nooit naar een andere server, ook niet
  // na een tikfout of een vervalst adres. Het beveiligingsbeleid in index.html houdt het ook tegen.
  if (!(await isEigenHomey(adres))) {
    fout.textContent = 'Dit is niet het adres van jouw Homey. Neem het adres over uit 1Password.';
    return;
  }

  if (sleutel.length < 32) {
    fout.textContent = 'De sleutel is te kort; hij moet minstens 32 tekens hebben.';
    return;
  }

  fout.textContent = '';
  instellingen = { adres, sleutel };
  localStorage.setItem(OPSLAG, JSON.stringify(instellingen));
  document.getElementById('sleutel').value = '';
  toonDashboard();
  start();
});

document.getElementById('opnieuw-instellen').addEventListener('click', () => {
  stop();
  toonInstelscherm(instellingen);
});

/* ---------- verbinding ---------- */

async function vraag(pad, inhoud) {
  const url = instellingen.adres + '/api/app/' + APP_ID + pad;
  let antwoord;

  try {
    antwoord = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: instellingen.sleutel }, inhoud)),
    });
  } catch (fout) {
    // Geen statuscode betekent dat het adres niet bereikbaar is; toon het erbij.
    throw new Error('Geen verbinding met ' + instellingen.adres);
  }

  const tekst = await antwoord.text();
  let gegevens = null;

  try {
    gegevens = tekst ? JSON.parse(tekst) : null;
  } catch (fout) {
    gegevens = null;
  }

  if (!antwoord.ok) {
    const melding = gegevens && (gegevens.error || gegevens.message);
    throw new Error(melding || ('Statuscode ' + antwoord.status));
  }

  return gegevens;
}

async function ververs() {
  try {
    teken(await vraag('/dashboard', {}));
    meldStatus('Bijgewerkt om ' + nu(), false);
  } catch (fout) {
    meldStatus(fout.message, true);
  }
}

async function stuur(kamer, groep, handeling, waarde) {
  try {
    const uitkomst = await vraag('/dashboard/command', {
      room: kamer, group: groep, action: handeling, value: waarde,
    });

    if (uitkomst && uitkomst.state) {
      teken(uitkomst.state);
    }

    meldStatus('Bijgewerkt om ' + nu(), false);
  } catch (fout) {
    meldStatus(fout.message, true);
  }
}

/* ---------- tekenen ---------- */

function nu() {
  return new Date().toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function meldStatus(tekst, isFout) {
  const veld = document.getElementById('status');
  veld.textContent = tekst;
  veld.className = isFout ? 'fout' : '';
}

function maakGroep(kamerId, groep) {
  const blok = document.createElement('div');
  blok.className = 'groep' + (groep.on ? ' aan' : '');

  const kop = document.createElement('div');
  kop.className = 'groep-kop';

  const namen = document.createElement('div');
  const naam = document.createElement('div');
  naam.className = 'groep-naam';
  naam.textContent = groep.name;

  const onder = document.createElement('div');
  onder.className = 'groep-onder';
  onder.textContent = groep.on
    ? (groep.dim === null ? 'Aan' : 'Aan, ' + Math.round(groep.dim * 100) + '%')
    : (groep.dim === null ? 'Uit' : 'Uit, staat op ' + Math.round(groep.dim * 100) + '%');

  namen.append(naam, onder);

  const schakelaar = document.createElement('button');
  schakelaar.className = 'schakelaar';
  schakelaar.setAttribute('aria-pressed', String(groep.on));
  schakelaar.setAttribute('aria-label', groep.name + (groep.on ? ' uitzetten' : ' aanzetten'));
  schakelaar.addEventListener('click', () => {
    stuur(kamerId, groep.id, groep.on ? 'off' : 'on');
  });

  kop.append(namen, schakelaar);
  blok.append(kop);

  const regelaar = document.createElement('input');
  regelaar.type = 'range';
  regelaar.min = '0';
  regelaar.max = '100';
  regelaar.value = String(Math.round((groep.dim === null ? 0 : groep.dim) * 100));
  regelaar.className = groep.on ? '' : 'gedempt';
  regelaar.setAttribute('aria-label', 'Helderheid ' + groep.name);
  // Tijdens het slepen niet overschrijven door een verversing; anders springt hij terug.
  regelaar.addEventListener('pointerdown', () => { bezigMetSlepen = true; });
  regelaar.addEventListener('change', () => {
    bezigMetSlepen = false;
    stuur(kamerId, groep.id, 'dim', Number(regelaar.value) / 100);
  });
  blok.append(regelaar);

  const problemen = [];

  if (groep.missing.length > 0) {
    problemen.push('Niet gevonden: ' + groep.missing.join(', '));
  }

  if (groep.unavailable.length > 0) {
    problemen.push('Onbereikbaar: ' + groep.unavailable.join(', '));
  }

  if (problemen.length > 0) {
    const melding = document.createElement('div');
    melding.className = 'melding';
    melding.textContent = problemen.join(' | ');
    blok.append(melding);
  }

  return blok;
}

function teken(toestand) {
  if (bezigMetSlepen || !toestand || !toestand.rooms) {
    return;
  }

  const houder = document.getElementById('kamers');
  houder.textContent = '';

  for (const kamer of toestand.rooms) {
    const kop = document.createElement('h2');
    kop.textContent = kamer.name;
    houder.append(kop);

    const rooster = document.createElement('div');
    rooster.className = 'groepen';

    for (const groep of kamer.groups) {
      rooster.append(maakGroep(kamer.id, groep));
    }

    houder.append(rooster);
  }
}

/* ---------- levensloop ---------- */

function start() {
  stop();
  ververs();
  timer = setInterval(ververs, VERVERS_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Staat het scherm uit, dan hoeft er niets ververst te worden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
  } else if (instellingen) {
    start();
  }
});

instellingen = laadInstellingen();

(async () => {
  if (instellingen && instellingen.sleutel && await isEigenHomey(instellingen.adres)) {
    toonDashboard();
    start();
  } else {
    toonInstelscherm(instellingen);
  }
})();

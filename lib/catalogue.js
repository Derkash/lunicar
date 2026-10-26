// Catalogue pour corriger le véhicule dans l'admin : marques et modèles courants en France (liste fixe),
// finitions et motorisations d'un modèle pour une année donnée (Claude, mémorisé dans les réglages).
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const MARQUES = {
    'Alfa Romeo': ['147', '156', '159', 'Giulietta', 'MiTo', 'Giulia', 'Stelvio', 'Tonale'],
    'Audi': ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
    'BMW': ['Série 1', 'Série 2', 'Série 3', 'Série 4', 'Série 5', 'Série 6', 'Série 7', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'Z4', 'i3'],
    'Chevrolet': ['Aveo', 'Captiva', 'Cruze', 'Matiz', 'Spark', 'Kalos', 'Lacetti'],
    'Citroën': ['C1', 'C2', 'C3', 'C3 Picasso', 'C3 Aircross', 'C4', 'C4 Picasso', 'C4 Grand Picasso', 'C4 Cactus', 'C5', 'C5 Aircross', 'C6', 'C8', 'Berlingo', 'DS3', 'DS4', 'DS5', 'Jumpy', 'Jumper', 'Nemo', 'Saxo', 'Xsara', 'Xsara Picasso', 'Spacetourer'],
    'Dacia': ['Sandero', 'Sandero Stepway', 'Logan', 'Logan MCV', 'Duster', 'Lodgy', 'Dokker', 'Jogger', 'Spring'],
    'DS': ['DS 3', 'DS 3 Crossback', 'DS 4', 'DS 5', 'DS 7', 'DS 9'],
    'Fiat': ['500', '500L', '500X', 'Panda', 'Punto', 'Grande Punto', 'Tipo', 'Bravo', 'Doblo', 'Ducato', 'Fiorino', 'Qubo', 'Multipla', 'Stilo', 'Scudo'],
    'Ford': ['Fiesta', 'Focus', 'Focus C-Max', 'C-Max', 'Grand C-Max', 'Mondeo', 'Ka', 'Ka+', 'Fusion', 'B-Max', 'S-Max', 'Galaxy', 'Kuga', 'EcoSport', 'Puma', 'Transit', 'Transit Connect', 'Transit Custom', 'Ranger', 'Mustang'],
    'Honda': ['Civic', 'Jazz', 'CR-V', 'HR-V', 'Accord', 'FR-V'],
    'Hyundai': ['i10', 'i20', 'i30', 'i40', 'ix20', 'ix35', 'Tucson', 'Santa Fe', 'Kona', 'Getz', 'Atos', 'Bayon'],
    'Jaguar': ['XE', 'XF', 'XJ', 'X-Type', 'S-Type', 'F-Pace', 'E-Pace'],
    'Jeep': ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler'],
    'Kia': ['Picanto', 'Rio', 'Ceed', 'Venga', 'Soul', 'Sportage', 'Sorento', 'Niro', 'Carens', 'Stonic', 'XCeed'],
    'Land Rover': ['Freelander', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Defender'],
    'Lexus': ['CT', 'IS', 'NX', 'RX', 'UX'],
    'Mazda': ['2', '3', '5', '6', 'CX-3', 'CX-30', 'CX-5', 'MX-5'],
    'Mercedes-Benz': ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'Classe S', 'CLA', 'CLK', 'CLS', 'GLA', 'GLB', 'GLC', 'GLE', 'ML', 'Classe M', 'Classe V', 'Vito', 'Viano', 'Sprinter', 'Citan', 'SLK'],
    'Mini': ['Cooper', 'One', 'Countryman', 'Clubman', 'Paceman', 'Cabrio'],
    'Mitsubishi': ['Colt', 'ASX', 'Outlander', 'Space Star', 'Pajero', 'L200'],
    'Nissan': ['Micra', 'Note', 'Juke', 'Qashqai', 'Qashqai+2', 'X-Trail', 'Pulsar', 'Leaf', 'Navara', 'Primastar', 'NV200', 'Almera', 'Primera'],
    'Opel': ['Corsa', 'Astra', 'Meriva', 'Zafira', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Adam', 'Karl', 'Agila', 'Vectra', 'Combo', 'Vivaro', 'Movano', 'Tigra'],
    'Peugeot': ['106', '107', '108', '206', '206+', '207', '208', '2008', '306', '307', '308', '3008', '406', '407', '508', '5008', '607', '806', '807', '1007', '4007', 'Bipper', 'Partner', 'Rifter', 'Expert', 'Boxer', 'RCZ', 'iOn'],
    'Porsche': ['911', 'Boxster', 'Cayman', 'Cayenne', 'Macan', 'Panamera'],
    'Renault': ['Twingo', 'Clio', 'Captur', 'Mégane', 'Mégane Scénic', 'Scénic', 'Grand Scénic', 'Laguna', 'Talisman', 'Kadjar', 'Koleos', 'Austral', 'Arkana', 'Espace', 'Modus', 'Grand Modus', 'Kangoo', 'Trafic', 'Master', 'Zoé', 'Fluence', 'Wind', 'Vel Satis'],
    'Seat': ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Altea', 'Altea XL', 'Toledo', 'Alhambra', 'Mii', 'Cordoba'],
    'Skoda': ['Fabia', 'Octavia', 'Superb', 'Rapid', 'Kamiq', 'Karoq', 'Kodiaq', 'Yeti', 'Roomster', 'Citigo', 'Scala'],
    'Smart': ['Fortwo', 'Forfour', 'Roadster'],
    'Ssangyong': ['Korando', 'Kyron', 'Rexton', 'Tivoli'],
    'Subaru': ['Impreza', 'Forester', 'Outback', 'Legacy', 'XV'],
    'Suzuki': ['Swift', 'Alto', 'Celerio', 'Ignis', 'Baleno', 'SX4', 'SX4 S-Cross', 'Vitara', 'Grand Vitara', 'Jimny', 'Splash', 'Wagon R+'],
    'Tesla': ['Model 3', 'Model S', 'Model X', 'Model Y'],
    'Toyota': ['Aygo', 'Yaris', 'Yaris Cross', 'Auris', 'Corolla', 'Prius', 'C-HR', 'RAV4', 'Verso', 'Avensis', 'Land Cruiser', 'Hilux', 'Proace', 'iQ', 'Urban Cruiser'],
    'Volkswagen': ['Polo', 'Golf', 'Golf Plus', 'Golf Sportsvan', 'Passat', 'Passat CC', 'Jetta', 'Touran', 'Tiguan', 'Touareg', 'T-Roc', 'T-Cross', 'Up!', 'Fox', 'Lupo', 'Scirocco', 'Sharan', 'Caddy', 'Transporter', 'Crafter', 'Coccinelle', 'ID.3', 'ID.4', 'Arteon', 'Eos'],
    'Volvo': ['C30', 'S40', 'S60', 'S80', 'V40', 'V50', 'V60', 'V70', 'XC40', 'XC60', 'XC70', 'XC90']
};

const MODEL = process.env.OCR_MODEL || 'claude-haiku-4-5-20251001';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 60 * 1000, maxRetries: 1 }) : null;

// Finitions et motorisations vendues en France pour ce modèle autour de cette année.
async function finitions(marque, modele, annee) {
    marque = String(marque || '').trim().slice(0, 40); modele = String(modele || '').trim().slice(0, 60); annee = String(annee || '').replace(/\D/g, '').slice(0, 4);
    if (!marque || !modele) throw new Error('Indiquez la marque et le modèle');
    const cle = `finitions:${marque}|${modele}|${annee}`.toLowerCase();
    const deja = await store.lireReglage(cle, null);
    if (deja) return deja;
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : recherche des finitions indisponible');
    const r = await client.messages.create({
        model: MODEL, max_tokens: 1500,
        messages: [{ role: 'user', content: `Pour une ${marque} ${modele}${annee ? ` de ${annee}` : ''} vendue neuve en France, liste les finitions (niveaux d'équipement commerciaux, ex. « Active », « Allure », « Zen ») et les motorisations (ex. « 1.6 HDi 110 ch diesel », « 1.2 PureTech 82 ch essence ») disponibles cette année-là, ainsi que les carrosseries si plusieurs (ex. « 5 portes », « SW », « Coupé »). N'invente rien : si tu n'es pas sûr, mets moins d'éléments. Réponds UNIQUEMENT par un objet JSON : {"finitions": [], "motorisations": [], "carrosseries": []}` }]
    });
    const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const l = v => (Array.isArray(v) ? v : []).map(s => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 30);
    const out = { finitions: l(j.finitions), motorisations: l(j.motorisations), carrosseries: l(j.carrosseries) };
    await store.ecrireReglage(cle, out).catch(() => {});
    return out;
}

module.exports = { MARQUES, finitions };

import type { Activity } from './types';

// Add new activities by appending to this array.
// `id` must be unique and stable — it's the key used for user-uploaded photos.
export const activities: Activity[] = [
  // ─────────────── Bay Area landmarks & attractions ───────────────
  {
    id: 'mt-diablo-summit',
    name: 'Mt. Diablo Summit',
    shortDescription:
      'Drive (or hike) to a 3,849-ft peak with one of the largest visible land surfaces of any mountain in the world.',
    longDescription:
      "Mount Diablo's summit visitor center sits at 3,849 ft in Contra Costa County. On clear winter days the panorama stretches from the Farallon Islands to the Sierra crest — locals swear you can pick out Half Dome. You can drive all the way up via North or South Gate Road, but trails near the summit (Summit Trail, Mary Bowerman) are off-limits to dogs.",
    category: 'scenic',
    region: 'east-bay',
    parkType: 'state',
    location: { city: 'Clayton', coords: { lat: 37.8817, lng: -121.9142 } },
    duration: 'Half Day',
    durationDetail: '~1.5h drive each way; quick summit walk',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/8/87/Mount_Diablo_Summit.JPG',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/mount-diablo-summit-via-mitchell-canyon-loop',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 6.8,
    hikeElevationFeet: 3274,
    notes: 'dog friendly, but dogs not allowed on trails near the summit',
  },
  {
    id: 'pescadero-duartes',
    name: "Duarte's Tavern & Pescadero Marsh",
    shortDescription:
      "Pair a flat marsh ramble with the legendary cream-of-artichoke soup and olallieberry pie at Duarte's Tavern.",
    longDescription:
      "Duarte's Tavern has been serving Pescadero since 1894 and is famous for olallieberry pie made from local berries. Pair lunch with a walk on the Sequoia Audubon Trail through Pescadero Marsh Natural Preserve, a key Pacific Flyway stop just across Highway 1. Allow time to wander Pescadero's tiny main street.",
    category: 'food',
    region: 'peninsula',
    parkType: 'none',
    location: { city: 'Pescadero', coords: { lat: 37.2522, lng: -122.3828 } },
    duration: 'Half Day',
    durationDetail: '~1h drive each way; lunch + 1-2 mi marsh walk',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/4/4d/Olallieberry_pie.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/pescadero-marsh-butano-creek',
    allTrailsRating: 4.4,
    hikeDistanceMiles: 1.9,
    hikeElevationFeet: 30,
    cuisine: 'American · seafood',
    priceRange: '$$',
    menuUrl: 'https://www.duartestavern.com/',
    dietary: ['vegetarian'],
    notes: 'Not dog friendly',
  },
  {
    id: 'point-reyes-seashore',
    name: 'Point Reyes National Seashore',
    shortDescription:
      'Windswept Marin peninsula of tule elk, lighthouse cliffs, and 80 miles of trails over 71,000 protected acres.',
    longDescription:
      'Point Reyes National Seashore protects a dramatic granite peninsula on the San Andreas Fault. Highlights include the Tomales Point Trail through the tule elk reserve, the Point Reyes Lighthouse, Drakes Beach, and Alamere Falls. Most trails ban dogs, but designated stretches at Limantour, Kehoe, and North Beaches allow leashed dogs.',
    category: 'hiking',
    region: 'north-bay',
    parkType: 'national',
    location: {
      city: 'Point Reyes Station',
      coords: { lat: 38.067, lng: -122.883 },
    },
    duration: 'Full Day',
    durationDetail: '~2h drive each way; pick a trail (e.g. Tomales Point 9.4 mi)',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/f/f0/Tomales_Bay_as_viewed_from_Tomales_Point_Trail_4.JPG',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/tomales-point-trail',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 9.4,
    hikeElevationFeet: 1289,
    notes: 'sections are dog friendly',
  },
  {
    id: 'lasermaxx-laser-tag',
    name: 'LaserMaxx Laser Tag',
    shortDescription:
      'Multi-level glowing-arena laser tag with smoke, music, and stat-tracking vests — pair with a Bay Area dim sum run.',
    longDescription:
      'LaserMaxx is a European laser-tag chain known for theatrical multi-level arenas, individualized scoring, and a serious competitive scene. The closest location is on East Capitol Expressway in San Jose. Reservations recommended, especially for groups; sessions run roughly 15-20 minutes.',
    category: 'other',
    region: 'south-bay',
    parkType: 'none',
    location: { city: 'San Jose', coords: { lat: 37.3011, lng: -121.8233 } },
    duration: '1-2 Hours',
    durationDetail: 'Sessions ~15-20 min; arrive 15 min early',
    coverImage:
      'https://images.unsplash.com/photo-1511882150382-421056c89033?auto=format&fit=crop&w=1600&q=80',
    notes: 'with Dim Sum Club',
  },
  {
    id: 'filoli-gardens',
    name: 'Filoli Historic House & Gardens',
    shortDescription:
      "654-acre Georgian Revival estate with 16 acres of formal gardens — Crystal Springs's hidden Edwardian treasure.",
    longDescription:
      'Filoli was built between 1915 and 1917 for gold-mine baron William Bowers Bourn II and is now run by the National Trust for Historic Preservation. The 16 acres of formal gardens include reflecting pools, a rose garden, and an espaliered orchard with hundreds of apple varieties. The mansion famously played the Carrington estate on Dynasty.',
    category: 'culture',
    region: 'peninsula',
    parkType: 'private',
    location: { city: 'Woodside', coords: { lat: 37.4704, lng: -122.3107 } },
    duration: 'Half Day',
    durationDetail: '~30 min drive each way; 2-3h on site',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/6/61/Filoli_Mansion.jpg',
  },
  {
    id: 'point-bonita-trail',
    name: 'Point Bonita Lighthouse & Black Sands Beach',
    shortDescription:
      'Suspension-bridge walk to a 1855 lighthouse on the Marin Headlands, plus a steep scramble to a hidden black-sand beach.',
    longDescription:
      "The Point Bonita Lighthouse Trail is a paved half-mile path through a hand-carved tunnel and across a small suspension bridge to an active 1855 lighthouse on the Marin Headlands. The lighthouse is open Sundays and Mondays only. A short drive away on Conzelman Road, the Upper Fisherman's Trail drops 300 ft in a third of a mile to Black Sands Beach.",
    category: 'scenic',
    region: 'north-bay',
    parkType: 'national',
    location: { city: 'Sausalito', coords: { lat: 37.8156, lng: -122.5296 } },
    duration: 'Half Day',
    durationDetail: '~1h drive; 1 mi lighthouse + 0.6 mi beach',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/d/d6/Point_Bonita_Lighthouse_in_May_2018.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/point-bonita-lighthouse',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 1.1,
    hikeElevationFeet: 203,
    notes: 'Black Sands Beach too!',
  },
  {
    id: 'alcatraz',
    name: 'Alcatraz Island',
    shortDescription:
      'Ferry to The Rock — federal pen, military fort, and Native American occupation site, all on a windswept island.',
    longDescription:
      "Alcatraz Island sits 1.25 miles off San Francisco in the bay, accessible only by ferry from Pier 33. The Cellhouse Audio Tour, narrated by former guards and inmates, is the highlight. Beyond the famous federal penitentiary (1934-1963) the island holds Civil War-era fortifications, the West Coast's first lighthouse, and the legacy of the 1969-1971 Native American occupation. Book tickets weeks in advance.",
    category: 'culture',
    region: 'sf',
    parkType: 'national',
    location: { city: 'San Francisco', coords: { lat: 37.8267, lng: -122.4228 } },
    duration: 'Half Day',
    durationDetail: 'Ferry + 2-3h on island',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/0/01/Alcatraz_Island_at_Sunset.jpg',
  },
  {
    id: 'baker-beach-presidio',
    name: 'Baker Beach & The Presidio',
    shortDescription:
      'Postcard Golden Gate Bridge views from a mile of sand, then wander 1,500 acres of forested former army post.',
    longDescription:
      "Baker Beach offers one of the most iconic views of the Golden Gate Bridge, framed by the Marin Headlands behind it. Combine with a stroll through the adjacent Presidio: hit the Lovers' Lane cypress allee, the Andy Goldsworthy installations (Spire, Wood Line), or the Battery Bluff overlook. Off-leash dogs welcome on the north end of Baker Beach.",
    category: 'scenic',
    region: 'sf',
    parkType: 'national',
    location: { city: 'San Francisco', coords: { lat: 37.7932, lng: -122.484 } },
    duration: 'Half Day',
    durationDetail: '~1h drive; 1-3h wander',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/4/4a/Golden_Gate_Bridge_from_Baker_Beach_%28Nighttime%29.jpg',
  },
  {
    id: 'pigeon-point-lighthouse',
    name: 'Pigeon Point Lighthouse',
    shortDescription:
      '115-ft 1872 lighthouse — one of the tallest in the U.S. — perched on a rugged Pescadero bluff above tide pools.',
    longDescription:
      "Pigeon Point Light Station was built in 1872 and remains one of the tallest lighthouses in the U.S. at 115 feet. The grounds are open daily, with sweeping views of the rocky coast, an excellent tide-pool zone at low tide, and a working hostel in the old keeper's housing. The tower itself has been under restoration but the bluff trail and views are stunning year-round.",
    category: 'scenic',
    region: 'peninsula',
    parkType: 'state',
    location: { city: 'Pescadero', coords: { lat: 37.1818, lng: -122.394 } },
    duration: 'Half Day',
    durationDetail: '~1h drive; 30-60 min on site',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/b/bb/Pigeon_Point_Lighthouse_%282016%29.jpg',
  },
  {
    id: 'gocars-sf',
    name: 'GoCar Tours of San Francisco',
    shortDescription:
      'Drive a buzzing yellow GPS-narrated trike around SF — Lombard, the Presidio, the Bridge, all on your own clock.',
    longDescription:
      'GoCars are tiny two-seat, three-wheeled fiberglass scooters that you drive yourself while a GPS-triggered audio guide narrates the city. Routes loop past Lombard Street, the Palace of Fine Arts, the Presidio, and Golden Gate Bridge viewpoints. Pickup is in Fisherman’s Wharf at 431 Beach Street. Bring sunglasses and a jacket — these things are open-air and surprisingly fast.',
    category: 'other',
    region: 'sf',
    parkType: 'none',
    location: { city: 'San Francisco', coords: { lat: 37.8074, lng: -122.4162 } },
    duration: 'Half Day',
    durationDetail: 'Tours run 1-5 hours self-guided',
    difficulty: 'easy',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/d/d3/Yellow_GoCarTours_SF_SunTrike_side.JPG',
  },
  {
    id: 'paddleboats-ggp',
    name: 'Stow Lake Paddleboats',
    shortDescription:
      'Pedal a paddleboat around Strawberry Hill in Golden Gate Park — turtles, herons, and a Chinese pavilion.',
    longDescription:
      'Stow Lake (officially renamed Blue Heron Lake in 2024) is a man-made lake encircling Strawberry Hill in Golden Gate Park. The historic boathouse rents paddleboats, rowboats, and electric boats by the hour. Spot herons, turtles, and the gifted Chinese Pavilion on the island. The cafe serves snacks for a leisurely afternoon.',
    category: 'water',
    region: 'sf',
    parkType: 'city',
    location: { city: 'San Francisco', coords: { lat: 37.7706, lng: -122.4771 } },
    duration: 'Half Day',
    durationDetail: '1h boat rental + park time',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/a/a8/Stow_Lake_-_Golden_Gate_Park%2C_San_Francisco%2C_CA_-_DSC09739.JPG',
  },
  {
    id: 'moss-beach-fitzgerald',
    name: 'Fitzgerald Marine Reserve Tide Pools',
    shortDescription:
      'Three miles of protected reef and tidepools at Moss Beach — anemones, hermit crabs, and the occasional harbor seal.',
    longDescription:
      'The James V. Fitzgerald Marine Reserve protects a particularly rich rocky intertidal shelf along three miles of San Mateo coast just north of Pillar Point. Time your visit around a minus tide for the best tidepooling; the Bluff Trail above offers cypress-shaded ocean views year-round. No collecting — every snail and starfish is protected.',
    category: 'scenic',
    region: 'peninsula',
    parkType: 'county',
    location: { city: 'Moss Beach', coords: { lat: 37.5106, lng: -122.5097 } },
    duration: 'Half Day',
    durationDetail: '~45 min drive; 1-2h on rocks (low tide)',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/16/Anemone%2C_Fitzgerald_Marine_Reserve%2C_CA.jpg',
  },

  // ─────────────── Yosemite ───────────────
  {
    id: 'yosemite-valley',
    name: 'Yosemite Valley',
    shortDescription:
      'Iconic granite valley — base camp for a multi-day Yosemite trip.',
    longDescription:
      'The heart of Yosemite National Park, a glacier-carved valley framed by El Capitan, Half Dome, and Bridalveil Fall. Use it as a base for Tunnel View, El Cap meadow, the valley loop drive, and short walks to waterfalls and meadows.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7217, lng: -119.6464 },
    },
    duration: 'Multi-Day',
    durationDetail: '~3.5h drive each way from Campbell — plan 2–3 nights',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/13/Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg',
    notes:
      'Dogs allowed only on paved roads, paved sidewalks, and developed areas — not on most trails.',
  },
  {
    id: 'yosemite-lower-fall',
    name: 'Lower Yosemite Fall',
    shortDescription:
      "Paved 1-mile loop to the base of North America's tallest waterfall.",
    longDescription:
      'Short, mostly flat paved loop with a stunning view of the 320-ft Lower Fall and the upper cascades above. One of the few Yosemite Valley trails open to leashed dogs because it is fully paved.',
    category: 'hiking',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7568, lng: -119.5968 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Hike ~30 min; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/3/38/Yosemite_falls_winter_2010.JPG',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/lower-yosemite-falls-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 1.2,
    hikeElevationFeet: 59,
  },
  {
    id: 'yosemite-bridalveil-fall',
    name: 'Bridal Veil Falls',
    shortDescription:
      'Short paved walk to the base of a 620-ft wind-blown waterfall.',
    longDescription:
      'Iconic Yosemite Valley waterfall, often the first you see on entering the park. Short paved trail from the Wawona Road parking area; dogs allowed on the paved portion only.',
    category: 'hiking',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7168, lng: -119.6465 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Hike ~20–30 min; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/73/Bridelveil_Falls_Yosemite.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/bridalveil-fall-trail',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 0.5,
    hikeElevationFeet: 80,
    notes: 'Dogs allowed on the paved portion only.',
  },
  {
    id: 'yosemite-mirror-lake',
    name: 'Mirror Lake',
    shortDescription:
      'Paved trail to a seasonal lake reflecting Half Dome and Mt. Watkins.',
    longDescription:
      'Easy, mostly flat paved approach from the shuttle stop along Tenaya Creek to Mirror Lake. The lake is best in spring/early summer when water levels are high enough to mirror the surrounding cliffs.',
    category: 'hiking',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7485, lng: -119.5491 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Hike ~1–2 hours; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/70/Yosemite_national_park_mirror_lake_2010u.JPG',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/mirror-lake-paved-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 2.1,
    hikeElevationFeet: 121,
    notes:
      '***dogs are allowed on the paved trail leading to the lake but are NOT allowed on the full loop once you reach the lake***',
  },
  {
    id: 'yosemite-cooks-sentinel-meadows',
    name: 'Cooks Meadow & Sentinel Meadow Loop',
    shortDescription:
      'Flat ~2-mile meadow loop with classic views of Yosemite Falls and Half Dome.',
    longDescription:
      "Easy, flat loop through Cook's and Sentinel Meadows on paved path and boardwalk, offering postcard views of Yosemite Falls, Half Dome, Sentinel Rock, and Royal Arches from the heart of the valley.",
    category: 'hiking',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7448, lng: -119.5974 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Hike ~45 min; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/13/Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/sentinel-meadow-cooks-meadow-loop-trail',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 2.0,
    hikeElevationFeet: 82,
    notes:
      'Stay on the paved path/boardwalk — meadow trampling is prohibited and dogs are restricted to paved surfaces.',
  },
  {
    id: 'yosemite-tunnel-view',
    name: 'Tunnel View',
    shortDescription:
      'The most iconic Yosemite Valley overlook — drive-up viewpoint.',
    longDescription:
      'Famous viewpoint at the east end of the Wawona Tunnel on Highway 41, with the classic vista of El Capitan, Bridalveil Fall, and Half Dome framing Yosemite Valley. Drive-up — no hike required.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7155, lng: -119.6772 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Quick stop; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/13/Tunnel_View%2C_Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg',
    notes: 'Leashed dogs allowed in the paved parking lot/overlook area.',
  },
  {
    id: 'yosemite-glacier-point',
    name: 'Glacier Point',
    shortDescription:
      'Panoramic 7,200-ft overlook of Half Dome, Vernal & Nevada Falls.',
    longDescription:
      'Spectacular overlook reached by a long but stunning drive up Glacier Point Road. A short paved walk from the lot leads to sweeping views of Half Dome, Yosemite Valley, and the high country. Road typically open late May through October/November.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7304, lng: -119.5736 },
    },
    duration: 'Multi-Day',
    durationDetail:
      '~1h drive each way from the valley; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/2/21/Glacier_Point_at_Sunset%2C_Yosemite_NP%2C_CA%2C_US_-_Diliff.jpg',
    notes:
      'Leashed dogs allowed on the paved parking lot and paved path to the overlook ("Paws on Pavement"). Glacier Point Road is closed in winter.',
  },
  {
    id: 'yosemite-curry-village-pizza',
    name: 'Curry Village Pizza Deck',
    shortDescription:
      'Outdoor pizza patio at Half Dome Village with Glacier Point views.',
    longDescription:
      'Casual outdoor pizza deck at Curry Village (Half Dome Village) serving hand-tossed pizzas, salads, and beer with views of Glacier Point and the Royal Arches. Classic post-hike spot in the valley.',
    category: 'food',
    region: 'norcal',
    parkType: 'national',
    location: {
      city: 'Yosemite National Park, CA',
      coords: { lat: 37.7434, lng: -119.5713 },
    },
    duration: 'Multi-Day',
    durationDetail: 'Meal stop; trip is overnight from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/71/Camp_Curry_Historic_District-12.jpg',
    cuisine: 'Pizza',
    priceRange: '$$',
    hours: 'Seasonal; typically afternoon–evening',
    menuUrl:
      'https://www.travelyosemite.com/dining/curry-village-pizza-deck/',
    dietary: ['vegetarian'],
    notes: 'great pizza and beer. Leashed dogs welcome on the outdoor patio.',
  },

  // ─────────────── California trails ───────────────
  {
    id: 'batteries-to-bluffs',
    name: 'Batteries to Bluffs Trail',
    shortDescription:
      'Rugged Presidio coastal trail past historic gun batteries to dramatic Pacific bluffs.',
    longDescription:
      "A short but stair-heavy clifftop route along the wild edge of the Presidio. Drops down to Marshall's Beach with sweeping views of the Golden Gate Bridge and Pacific Ocean.",
    category: 'hiking',
    region: 'sf',
    parkType: 'national',
    location: { city: 'San Francisco', coords: { lat: 37.7973, lng: -122.4793 } },
    duration: '1-2 Hours',
    durationDetail: '~45 min on trail; short drive from Campbell (~1 hr each way)',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/c/c7/Golden_Gate_Bridge_as_seen_from_Marshall%E2%80%99s_Beach%2C_March_2018.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/batteries-to-bluffs-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 1.6,
    hikeElevationFeet: 282,
    notes: '(no dogs). 470 stairs, be prepared!',
  },
  {
    id: 'steep-ravine-trail',
    name: 'Steep Ravine Trail (Mt Tam State Park)',
    shortDescription:
      'Lush redwood ravine with a wooden ladder, creek crossings, and seasonal waterfalls on Mt Tam.',
    longDescription:
      'Most often hiked as the Dipsea–Steep Ravine loop from Pantoll. Climbs through fern-draped redwoods alongside Webb Creek with a memorable 14-rung wooden ladder. Tight, rocky, and dramatic.',
    category: 'hiking',
    region: 'north-bay',
    parkType: 'state',
    location: { city: 'Mill Valley', coords: { lat: 37.9046, lng: -122.604 } },
    duration: 'Half Day',
    durationDetail: '~2-2.5 hr loop; ~1.5 hr drive each way from Campbell',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/6/61/Stinson_Beach_from_Dipsea_Trail_in_Mount_Tamalpais_State_Park.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/dipsea-trail-to-steep-ravine-trail-loop-from-pantoll',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 3.9,
    hikeElevationFeet: 961,
    notes: 'Steep, narrow. Waterfalls!',
  },
  {
    id: 'mt-tam-vernal-falls-dunshee',
    name: 'Mt Tam Verna Dunshee Trail (East Peak)',
    shortDescription:
      "Paved summit loop around Mt Tam's East Peak with 360-degree Bay Area views.",
    longDescription:
      'Note: this is the Marin County Mt Tamalpais "Verna Dunshee" loop (not Yosemite\'s Vernal Falls). An easy paved/accessible loop encircling the East Peak summit, often combined with the short Plank Trail to the historic Gardner fire lookout.',
    category: 'hiking',
    region: 'north-bay',
    parkType: 'state',
    location: { city: 'Mill Valley', coords: { lat: 37.9296, lng: -122.5793 } },
    duration: 'Half Day',
    durationDetail: '~30-60 min on trail; ~1.5 hr drive each way from Campbell',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/4/47/Firewatch_tower_at_the_summit_of_Mount_Tam.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/verna-dunshee-trail-and-plank-trail-at-mount-tam-east-peak',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 1.3,
    hikeElevationFeet: 275,
  },
  {
    id: 'cataract-falls-mt-tam',
    name: 'Cataract Falls Trail',
    shortDescription:
      'A mile-long series of cascading waterfalls tumbling through redwoods on Mt Tam.',
    longDescription:
      'From the Bolinas-Fairfax Road trailhead near Alpine Lake, the trail climbs steeply along Cataract Creek, passing a beautiful chain of waterfalls and ferny grottoes up to Laurel Dell. Best in winter and spring.',
    category: 'hiking',
    region: 'north-bay',
    parkType: 'state',
    location: { city: 'Fairfax', coords: { lat: 37.9367, lng: -122.6379 } },
    duration: 'Half Day',
    durationDetail: '~2-2.5 hr hike; ~1.75 hr drive each way from Campbell',
    difficulty: 'advanced',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/0/07/Cataract_Falls%2C_Mount_Tamalpais_Watershed.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/cataract-falls-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 3.0,
    hikeElevationFeet: 1053,
  },
  {
    id: 'el-corte-de-madera',
    name: 'El Corte de Madera (Tafoni Loop)',
    shortDescription:
      'Redwood preserve on Skyline Blvd featuring a giant honeycombed sandstone Tafoni formation and a Vista Point.',
    longDescription:
      'Quiet, fern-filled forest loop in the Midpeninsula Open Space District. Highlights are the otherworldly Tafoni sandstone wall and a Vista Point with views west toward the coast and a 1953 plane crash memorial placard.',
    category: 'hiking',
    region: 'peninsula',
    parkType: 'regional',
    location: { city: 'Redwood City', coords: { lat: 37.4291, lng: -122.3148 } },
    duration: 'Half Day',
    durationDetail: '~2-2.5 hr loop; ~45 min drive each way from Campbell',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/8/88/Tafoni_in_El_Corte_de_Madera_Creek_Open_Space_Preserve_1.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/tafoni-loop',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 4.1,
    hikeElevationFeet: 702,
  },
  {
    id: 'blue-heron-strawberry-hill',
    name: 'Blue Heron Lake and Strawberry Hill Loop',
    shortDescription:
      'Easy Golden Gate Park loop around Blue Heron Lake (formerly Stow Lake) and up to Strawberry Hill.',
    longDescription:
      'A flat perimeter walk around the lake plus a short climb up Strawberry Hill island, passing Huntington Falls (a 110-foot artificial waterfall), stone bridges, and the Chinese Pavilion. Great wildlife and joggers/birders.',
    category: 'hiking',
    region: 'sf',
    parkType: 'city',
    location: { city: 'San Francisco', coords: { lat: 37.7706, lng: -122.4772 } },
    duration: 'Half Day',
    durationDetail: '~30-60 min loop; ~1 hr drive each way from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/0/0f/SF_Golden-Gate_Park_waterfall.JPG',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/stow-lake-and-strawberry-hill-loop',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 2.3,
    hikeElevationFeet: 160,
  },
  {
    id: 'castle-rock-state-park',
    name: 'Castle Rock State Park (Saratoga Gap & Ridge Loop)',
    shortDescription:
      'Skyline-ridge loop through redwoods past sandstone formations, Castle Rock Falls, and Castle Rock itself.',
    longDescription:
      'Classic Santa Cruz Mountains loop along the Saratoga Gap and Ridge trails. Features the seasonal Castle Rock Falls overlook, dramatic ridge-top vista benches, and the namesake Castle Rock — a popular sandstone bouldering hub.',
    category: 'hiking',
    region: 'south-bay',
    parkType: 'state',
    location: { city: 'Los Gatos', coords: { lat: 37.2306, lng: -122.0974 } },
    duration: 'Half Day',
    durationDetail: '~2.5-3 hr loop; ~25 min drive each way from Campbell',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/77/Castle_Rock_State_Park_in_California_with_rock_formations.JPG',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/saratoga-gap-trail-ridge-trail-and-castle-rock-trail-loop',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 5.0,
    hikeElevationFeet: 1040,
  },
  {
    id: 'loris-point',
    name: 'Mori Point Loop',
    shortDescription:
      'Short clifftop loop above the Pacific in Pacifica with sweeping coastal views.',
    longDescription:
      'A breezy headland just above Pacifica Pier with grass-and-wildflower bluffs, the "Bootleggers Steps," and dramatic ocean overlooks — popular for sunsets and whale watching. Likely the trail the user meant by "Lori Point."',
    category: 'hiking',
    region: 'peninsula',
    parkType: 'national',
    location: { city: 'Pacifica', coords: { lat: 37.6192, lng: -122.4865 } },
    duration: '1-2 Hours',
    durationDetail: '~1-1.5 hr loop; ~50 min drive each way from Campbell',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/a/a9/Mori_Point_and_Pedro_Rock_-_Pacifica_California_%289060243134%29.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/mori-point-loop-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 2.6,
    hikeElevationFeet: 400,
  },
  {
    id: 'shark-fin-cove',
    name: 'Shark Fin Cove (Bonny Doon Beach Loop)',
    shortDescription:
      'Iconic shark-fin-shaped sea stack and secluded coves north of Santa Cruz.',
    longDescription:
      'Easy coastal walk along bluffs with stunning views of the namesake fin-shaped rock, sea caves, and sandy pocket beaches. Steep, sandy descents lead to the beach.',
    category: 'hiking',
    region: 'central-coast',
    parkType: 'none',
    location: { city: 'Davenport', coords: { lat: 37.0037, lng: -122.1864 } },
    duration: 'Half Day',
    durationDetail: '~30-60 min on trail; ~1 hr drive each way from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/ed/Shark_Fin_Cove_near_Davenport%2C_California_%28Unsplash%29.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/bonney-doon-beach-and-shark-fin-cove-loop',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 2.3,
    hikeElevationFeet: 134,
  },
  {
    id: 'hidden-villa-trails',
    name: 'Hidden Villa Hiking Trails',
    shortDescription:
      'Working organic farm and educational preserve in Los Altos Hills with shaded creek-and-ridge loops.',
    longDescription:
      'A 1,600-acre nonprofit preserve combining heritage farm visits with a network of hiking loops (Creek/Pipeline, Toyon, Bunny, Ewing Hill). Ewing Hill Loop is the standout for views. $10 parking fee; closed Mondays.',
    category: 'hiking',
    region: 'south-bay',
    parkType: 'private',
    location: { city: 'Los Altos Hills', coords: { lat: 37.3514, lng: -122.161 } },
    duration: 'Half Day',
    durationDetail:
      '~2-3 hr depending on loop; ~15-20 min drive each way from Campbell',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/0/09/Hidden_Villa_Education_Center_2010.jpg',
    allTrailsUrl: 'https://www.alltrails.com/parks/us/california/hidden-villa',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 4.9,
    hikeElevationFeet: 1266,
    notes: 'Dogs allowed on the farm but NOT on hiking trails (per Hidden Villa policy, March 2021).',
  },

  // ─────────────── Mendocino long weekend ───────────────
  {
    id: 'point-cabrillo-lighthouse',
    name: 'Point Cabrillo Lighthouse',
    shortDescription:
      'Historic 1909 lighthouse on a windswept Mendocino headland.',
    longDescription:
      "A working light station perched above dramatic sea cliffs north of Mendocino village, set within a 300-acre coastal preserve with restored keeper's houses, a small museum, and an easy walk down to the lighthouse.",
    category: 'culture',
    region: 'norcal',
    parkType: 'state',
    location: { city: 'Mendocino', coords: { lat: 39.3486, lng: -123.8261 } },
    duration: 'Weekend',
    durationDetail: 'Mendocino long weekend',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/d/d7/Point_Cabrillo_Lighthouse%2C_on_an_early_morning_in_February.jpg',
    notes: 'Mendocino long-weekend trip — consider staying at Heritage House.',
  },
  {
    id: 'skunk-train-railbikes',
    name: 'Skunk Train Rail Bikes',
    shortDescription:
      'Pedal-powered rail bikes through old-growth redwoods on the historic Skunk Train route.',
    longDescription:
      "Two-person electric-assist rail bikes ride the California Western Railroad's century-old logging route out of Fort Bragg (or Willits), gliding past redwoods, ferns, and the Noyo River. Pricey, but a one-of-a-kind way to see the Mendocino backcountry.",
    category: 'other',
    region: 'norcal',
    parkType: 'private',
    location: { city: 'Fort Bragg', coords: { lat: 39.4455, lng: -123.8068 } },
    duration: 'Weekend',
    durationDetail: 'Mendocino long weekend',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/e8/Skunktrain.jpg',
    notes: 'Pricey but looks hella fun',
  },
  {
    id: 'russian-gulch-state-park',
    name: 'Russian Gulch State Park',
    shortDescription:
      "Coastal state park with the Devil's Punch Bowl blowhole and a 36-foot waterfall hike.",
    longDescription:
      "Just north of Mendocino village, Russian Gulch packs in cliffs, a sea-collapsed tunnel known as the Devil's Punch Bowl, a sandy cove, and a forested 5+ mile loop that climbs through second-growth redwoods to a 36-foot waterfall.",
    category: 'hiking',
    region: 'norcal',
    parkType: 'state',
    location: { city: 'Mendocino', coords: { lat: 39.333, lng: -123.783 } },
    duration: 'Weekend',
    durationDetail: 'Mendocino long weekend',
    difficulty: 'moderate',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/70/Russian_Gulch_Beach.jpg',
    allTrailsUrl:
      'https://www.alltrails.com/trail/us/california/russian-gulch-falls-loop-trail',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 5.5,
    hikeElevationFeet: 600,
  },
  {
    id: 'point-arena-lighthouse',
    name: 'Point Arena Lighthouse',
    shortDescription:
      '115-foot lighthouse you can climb for sweeping Pacific views.',
    longDescription:
      "The tallest lighthouse on the West Coast that's open to the public — climb the 145 steps to the lantern room for panoramic ocean views and (in season) gray whale spotting. Sits on a long, narrow headland that juts into the Pacific south of Mendocino.",
    category: 'culture',
    region: 'norcal',
    parkType: 'private',
    location: { city: 'Point Arena', coords: { lat: 38.9548, lng: -123.7406 } },
    duration: 'Weekend',
    durationDetail: 'Mendocino long weekend',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/6/6e/Point_Arena_Lighthouse%2C_Mendocino_County.jpg',
  },
  {
    id: 'mendocino-headlands-arch',
    name: 'Mendocino Headlands & Arch',
    shortDescription:
      'Clifftop trails wrapping the village of Mendocino with views of the Mendocino Bay sea arch.',
    longDescription:
      'A grassy, wind-blown bluff park that surrounds the historic town of Mendocino on three sides. Easy meandering paths along jagged cliffs, hidden beaches, and the iconic arch off Mendocino Bay.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'state',
    location: { city: 'Mendocino', coords: { lat: 39.3083, lng: -123.8056 } },
    duration: 'Weekend',
    durationDetail: 'Mendocino long weekend',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/1f/Ford_house%2C_Mendocino%2C_California.jpg',
  },

  // ─────────────── Scenic West Coast ───────────────
  {
    id: 'samuel-h-boardman',
    name: 'Samuel H. Boardman State Scenic Corridor',
    shortDescription:
      '12 miles of dramatic southern Oregon coastline — sea stacks, arches, and hidden coves.',
    longDescription:
      'Stretching along Highway 101 just north of Brookings, this scenic corridor strings together overlooks, secret beaches, and short trails to Natural Bridges, Secret Beach, and Indian Sands. One of the most photogenic stretches of the entire West Coast.',
    category: 'scenic',
    region: 'oregon',
    parkType: 'state',
    location: { city: 'Brookings', coords: { lat: 42.1201, lng: -124.3553 } },
    duration: 'Multi-Day',
    durationDetail: '~9 hour drive from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/7/72/Natural_Bridges_Cove_-_Boardman_State_Park%2C_Oregon.jpg',
  },
  {
    id: 'fern-canyon-trail',
    name: 'Fern Canyon Trail',
    shortDescription:
      'Lush vertical fern-walled canyon in Prairie Creek Redwoods made famous by Jurassic Park.',
    longDescription:
      'A short, otherworldly walk through a narrow canyon whose 50-foot walls drip with seven different species of ferns. Plan for wet feet — the trail crosses Home Creek several times. Combine with redwood loops for a longer day.',
    category: 'hiking',
    region: 'norcal',
    parkType: 'state',
    location: { city: 'Orick', coords: { lat: 41.4026, lng: -124.0684 } },
    duration: 'Multi-Day',
    durationDetail: '7h north of San Jose',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/5/56/Fern_Canyon_in_Redwood_National_Park%2C_California_with_tree_upside_down..jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/fern-canyon-loop-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 1.1,
    hikeElevationFeet: 100,
    notes: '7h north of SJ',
  },
  {
    id: 'hot-creek',
    name: 'Hot Creek Geological Site',
    shortDescription:
      'Steaming geothermal creek winding through a vivid blue-green volcanic gorge near Mammoth.',
    longDescription:
      "A short walk down to a viewing area where Hot Creek's icy snowmelt mixes with boiling geothermal vents — clouds of steam rise off turquoise pools set against the eastern Sierra. Swimming is prohibited (and dangerous), but the view is unreal.",
    category: 'scenic',
    region: 'norcal',
    parkType: 'none',
    location: { city: 'Mammoth Lakes', coords: { lat: 37.6606, lng: -118.8281 } },
    duration: 'Multi-Day',
    durationDetail: '~6-7 hour drive from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/ec/Hot_Creek_steam.jpg',
    notes: 'near Yosemite',
  },
  {
    id: 'mammoth-lakes',
    name: 'Mammoth Lakes',
    shortDescription:
      'Eastern Sierra alpine basin — hiking, lakes, and hot springs in summer; world-class skiing in winter.',
    longDescription:
      'A high-elevation mountain town wrapped by the Mammoth Lakes Basin, Devils Postpile, the Minarets, and endless trail miles. Summer brings turquoise lakes, wildflowers, and Reds Meadow; winter brings one of the best ski resorts on the West Coast.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'none',
    location: { city: 'Mammoth Lakes', coords: { lat: 37.6273, lng: -118.9899 } },
    duration: 'Multi-Day',
    durationDetail: '~6-7 hour drive from Campbell',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/e3/Mammoth_Lakes_Village.jpg',
  },
  {
    id: 'alabama-hills',
    name: 'Alabama Hills',
    shortDescription:
      'Otherworldly orange boulder fields and natural arches with Mt. Whitney as backdrop.',
    longDescription:
      'A jumbled landscape of rounded granite outcrops at the foot of the Sierra escarpment outside Lone Pine. Mobius Arch, Lathe Arch, and Movie Road are easy to find, and Mt. Whitney looms over everything. Free dispersed camping under huge skies.',
    category: 'scenic',
    region: 'socal',
    parkType: 'none',
    location: { city: 'Lone Pine', coords: { lat: 36.6147, lng: -118.0959 } },
    duration: 'Multi-Day',
    durationDetail: '~7-8 hour drive from Campbell',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/8/8a/A345%2C_Mobius_Arch%2C_Alabama_Hills%2C_California%2C_USA%2C_2011.JPG',
  },
  {
    id: 'june-lake-loop',
    name: 'June Lake Loop',
    shortDescription:
      '16-mile Highway 158 scenic loop linking four eastern Sierra lakes — best in fall aspen color.',
    longDescription:
      'A horseshoe-shaped scenic byway off US-395 that strings together June, Gull, Silver, and Grant lakes. Surrounded by Carson Peak and aspen groves that turn brilliant gold in late September and early October. Trailheads, paddling, and small-town stops along the way.',
    category: 'scenic',
    region: 'norcal',
    parkType: 'none',
    location: { city: 'June Lake', coords: { lat: 37.7511, lng: -119.1139 } },
    duration: 'Multi-Day',
    durationDetail: '~6-7 hour drive from Campbell; best in fall',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/3/3b/Town_of_June_Lake.JPG',
  },

  // ─────────────── Coast trips & libraries ───────────────
  {
    id: 'carmel-by-the-sea',
    name: 'Carmel-by-the-Sea',
    shortDescription:
      'Charming coastal village with off-leash Carmel Beach.',
    longDescription:
      'Storybook coastal village on the Monterey Peninsula known for white-sand Carmel Beach (one of the most famous off-leash dog beaches in California), fairy-tale cottages, art galleries, wine-tasting rooms, and a notably dog-friendly downtown where many shops and restaurant patios welcome pups.',
    category: 'scenic',
    region: 'central-coast',
    parkType: 'none',
    location: {
      city: 'Carmel-by-the-Sea, CA',
      coords: { lat: 36.5553, lng: -121.9233 },
    },
    duration: 'Full Day',
    durationDetail: 'Half Day or Full Day',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/3/39/Butterfly_House_with_beach_view_%28cropped%29.jpg',
  },
  {
    id: 'big-sur-river-gorge',
    name: 'Float and Swim in Big Sur River Gorge',
    shortDescription:
      'Swim hole in Pfeiffer Big Sur State Park river gorge.',
    longDescription:
      'Hike up the Big Sur River through Pfeiffer Big Sur State Park to the legendary Big Sur River Gorge swimming hole, a stretch of clear pools and granite slabs deep in a redwood-lined canyon. Perfect for a hot-day float and swim; route involves rock-hopping and short wades upriver.',
    category: 'water',
    region: 'central-coast',
    parkType: 'none',
    location: { city: 'Big Sur, CA', coords: { lat: 36.25, lng: -121.783 } },
    duration: 'Full Day',
    durationDetail: 'Full Day or Weekend',
    difficulty: 'moderate',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/3/3f/Julia_Pfeiffer_Burns_State_Park.jpg',
  },
  {
    id: 'partington-cove-trail',
    name: 'Partington Cove Trail (steep!)',
    shortDescription:
      'Short, steep Big Sur trail through a tunnel to a hidden cove.',
    longDescription:
      'Quick but steep out-and-back along Highway 1 in Big Sur that drops into Partington Canyon, crosses a wooden bridge, and tunnels through the rock to a tiny historic cove once used for shipping tanbark. Big drama for the distance.',
    category: 'hiking',
    region: 'central-coast',
    parkType: 'state',
    location: { city: 'Big Sur, CA', coords: { lat: 36.177, lng: -121.6937 } },
    duration: '1-2 Hours',
    difficulty: 'moderate',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/3/3f/Julia_Pfeiffer_Burns_State_Park.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/partington-cove-trail',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 1.2,
    hikeElevationFeet: 331,
    notes: 'steep!',
  },
  {
    id: 'solvang',
    name: 'Solvang (Danish town in CA)',
    shortDescription:
      'Danish-themed village in the Santa Ynez Valley wine country.',
    longDescription:
      "Founded by Danish-American immigrants in 1911, Solvang fills a few square blocks of the Santa Ynez Valley with half-timbered facades, windmills, aebleskiver bakeries, and a replica of Copenhagen's Little Mermaid. Pair with Santa Ynez wineries and Mission Santa Inés.",
    category: 'culture',
    region: 'central-coast',
    parkType: 'none',
    location: { city: 'Solvang, CA', coords: { lat: 34.5939, lng: -120.1397 } },
    duration: 'Weekend',
    notes: '4 hrs away',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/c/cd/Tivoli_Square_Solvang.jpg',
  },
  {
    id: 'hearst-castle',
    name: 'Hearst Castle',
    shortDescription:
      "William Randolph Hearst's opulent hilltop estate above San Simeon.",
    longDescription:
      'Designed by Julia Morgan for newspaper magnate William Randolph Hearst, this 165-room hilltop estate above the Pacific is a National Historic Landmark filled with European antiquities, Mediterranean gardens, and the famous Neptune Pool. Tours run daily from the visitor center in San Simeon.',
    category: 'culture',
    region: 'central-coast',
    parkType: 'state',
    location: { city: 'San Simeon, CA', coords: { lat: 35.6853, lng: -121.1678 } },
    duration: 'Full Day',
    durationDetail: 'Full Day or Weekend',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/b/be/Hearst_Castle_panorama.jpg',
  },
  {
    id: 'santa-catalina-island',
    name: 'Santa Catalina Island',
    shortDescription:
      'Boat from LA to the Mediterranean-feeling town of Avalon.',
    longDescription:
      "Catch the Catalina Express ferry from Long Beach, San Pedro, or Dana Point to Avalon, a pastel harbor town 22 miles offshore. Snorkel the kelp forests at Lover's Cove, take a glass-bottom-boat tour, hike to the Wrigley Memorial, or head to Two Harbors for quieter coves and bison sightings.",
    category: 'scenic',
    region: 'socal',
    parkType: 'private',
    location: { city: 'Avalon, CA', coords: { lat: 33.3408, lng: -118.3278 } },
    duration: 'Multi-Day',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/d/d1/Avalon_Catalina_photo_D_Ramey_Logan.jpg',
  },
  {
    id: 'channel-islands',
    name: 'Channel Islands',
    shortDescription:
      "National park archipelago off Ventura, \"California's Galápagos.\"",
    longDescription:
      'Channel Islands National Park protects five rugged islands off the Ventura coast — Anacapa, Santa Cruz, Santa Rosa, San Miguel, and Santa Barbara — reachable by Island Packers boat. Sea-cave kayaking at Scorpion Anchorage, snorkeling kelp forests, hiking to Inspiration Point, and spotting endemic island foxes are highlights.',
    category: 'scenic',
    region: 'socal',
    parkType: 'national',
    location: { city: 'Ventura, CA', coords: { lat: 34.0083, lng: -119.4167 } },
    duration: 'Multi-Day',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/9/95/Channel_Islands_11.jpg',
  },
  {
    id: 'discover-and-go',
    name: 'Discover and Go via library',
    shortDescription:
      'Free museum passes through your local library.',
    longDescription:
      'Discover & Go is a free reservation system available through participating Bay Area libraries that lets cardholders book passes to dozens of museums, science centers, and gardens at little or no cost. Book online with your library card, print or save the pass, and show it at the door.',
    category: 'culture',
    region: 'sf',
    parkType: 'none',
    location: { city: 'Bay Area, CA', coords: { lat: 37.78, lng: -122.42 } },
    duration: 'Half Day',
    notes:
      'Get free passes to places like the Asian Art Museum, California Academy of Sciences, Chabot Space & Science Center, the de Young, the Exploratorium, the San Francisco Museum of Modern Art, and The Tech Interactive.',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/c/cc/M._H._de_Young_Memorial_Museum.jpg',
  },
  {
    id: 'santa-clara-central-library',
    name: 'Santa Clara Central Park Library',
    shortDescription:
      'Modern flagship branch of Santa Clara City Library.',
    longDescription:
      "Santa Clara's flagship Central Park Library at 2635 Homestead Road is a bright, modern 80,000-sq-ft branch overlooking Central Park, with a large children's area, makerspace, study rooms, and a busy events calendar.",
    category: 'culture',
    region: 'south-bay',
    parkType: 'none',
    location: { city: 'Santa Clara, CA', coords: { lat: 37.349, lng: -121.9831 } },
    duration: '1-2 Hours',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/b/bd/Santa_Clara_Central_Park_Library.jpg',
  },
  {
    id: 'los-gatos-library',
    name: 'Los Gatos Library',
    shortDescription:
      'Award-winning LEED Gold "lantern in the woods" library.',
    longDescription:
      "Built in 2012 and designed to feel like a lantern in the woods, the 30,000-sq-ft Los Gatos Library at 100 Villa Avenue is LEED Gold certified, with two floors of light-filled reading space, a teen lounge, and a robust children's wing.",
    category: 'culture',
    region: 'south-bay',
    parkType: 'none',
    location: { city: 'Los Gatos, CA', coords: { lat: 37.2202, lng: -121.9782 } },
    duration: '1-2 Hours',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/c/c7/Los_Gatos_Library.jpg',
    completed: true,
  },
  {
    id: 'saratoga-library',
    name: 'Saratoga Library',
    shortDescription: 'Santa Clara County branch in downtown Saratoga.',
    longDescription:
      "Part of the Santa Clara County Library District, the Saratoga Library at 13650 Saratoga Avenue is a comfortable neighborhood branch with a strong children's collection, quiet study areas, and rotating community programs.",
    category: 'culture',
    region: 'south-bay',
    parkType: 'none',
    location: { city: 'Saratoga, CA', coords: { lat: 37.2705, lng: -122.015 } },
    duration: '1-2 Hours',
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/5/59/USA-Saratoga-Village_Library.jpg',
    completed: true,
  },

  // ─────────────── Completed adventures ───────────────
  {
    id: 'muir-woods-loop',
    name: 'Muir Woods Main Trail Loop',
    shortDescription:
      'Walk among ancient coast redwoods on the flat main loop through Muir Woods National Monument.',
    longDescription:
      'A peaceful, mostly flat boardwalk loop through old-growth coast redwoods along Redwood Creek. The towering trees and hushed forest air make this one of the most contemplative short hikes in the Bay Area. Reservations are required for both parking and the shuttle.',
    category: 'hiking',
    region: 'north-bay',
    parkType: 'national',
    location: { city: 'Mill Valley', coords: { lat: 37.8919, lng: -122.5708 } },
    duration: '1-2 Hours',
    durationDetail: '~1 hour for the main loop',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/1/14/Muir1.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/muir-main-trail',
    allTrailsRating: 4.7,
    hikeDistanceMiles: 1.5,
    hikeElevationFeet: 45,
    completed: true,
    notes: 'Supposedly very meditative',
  },
  {
    id: 'sutro-baths-coastal-trail',
    name: 'Sutro Baths to Presidio via Coastal Trail',
    shortDescription:
      'Explore the haunting Sutro Baths ruins and walk the cliffside Lands End Coastal Trail toward the Presidio.',
    longDescription:
      'Start at the dramatic concrete ruins of the Sutro Baths above Ocean Beach, then follow the Lands End Coastal Trail east through cypress groves with sweeping views of the Golden Gate Bridge, Marin Headlands, and Mile Rock. The route continues along the coast toward the Presidio for a longer one-way coastal walk.',
    category: 'hiking',
    region: 'sf',
    parkType: 'national',
    location: { city: 'San Francisco', coords: { lat: 37.78, lng: -122.5136 } },
    duration: 'Half Day',
    durationDetail: '~3-4 hours one way to the Presidio',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/b/bd/Sutro_Baths_in_San_Francisco.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/lands-end-trail',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 3.4,
    hikeElevationFeet: 350,
    completed: true,
  },
  {
    id: 'lands-end',
    name: 'Lands End',
    shortDescription:
      'Cliff-top coastal trail with 30-mile views, the Mile Rock labyrinth, and access to hidden beaches.',
    longDescription:
      'A scenic San Francisco coastal walk through cypress and Monterey pine along bluffs at the western edge of the city. Highlights include the Lands End Lookout, Mile Rock Beach, the stone labyrinth, and constant views of the Golden Gate Bridge.',
    category: 'scenic',
    region: 'sf',
    parkType: 'national',
    location: { city: 'San Francisco', coords: { lat: 37.7849, lng: -122.5055 } },
    duration: '2-3 Hours',
    difficulty: 'moderate',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/5/5d/Lands_End_Trail%2C_San_Francisco_%2835426543562%29.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/lands-end-trail',
    allTrailsRating: 4.8,
    hikeDistanceMiles: 3.4,
    hikeElevationFeet: 350,
    completed: true,
  },
  {
    id: 'lgct-bike-ride',
    name: 'Los Gatos Creek Trail Bike Ride',
    shortDescription:
      'Ride the LGCT from Lexington Reservoir down through Los Gatos and Campbell toward San Jose.',
    longDescription:
      'A multi-use paved and gravel path that follows Los Gatos Creek for roughly 10 miles, passing Lexington Reservoir, Vasona Lake, and the Campbell percolation ponds. Mostly flat with a gentle downhill grade riding north — a classic local cruise from the foothills to the valley floor.',
    category: 'cycling',
    region: 'south-bay',
    parkType: 'county',
    location: { city: 'Campbell', coords: { lat: 37.2872, lng: -121.945 } },
    duration: 'Half Day',
    durationDetail: '~2-3 hours one way by bike',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/d/d5/Los_Gatos_Creek_Trail_%28Campbell%2C_California%29.jpg',
    allTrailsUrl: 'https://www.alltrails.com/trail/us/california/los-gatos-creek-trail--5',
    allTrailsRating: 4.6,
    hikeDistanceMiles: 10.2,
    hikeElevationFeet: 98,
    completed: true,
  },
  {
    id: 'foster-city-lagoons',
    name: 'Foster City Lagoons & Parks',
    shortDescription:
      'Walk the network of lagoons and waterfront parks winding through Foster City.',
    longDescription:
      'Foster City is laced with interconnected lagoons and a long string of small waterfront parks and paved paths. An easy, flat outing perfect for a leisurely loop on foot or bike, with bay views, picnic spots, and lots of friendly locals walking dogs.',
    category: 'scenic',
    region: 'peninsula',
    parkType: 'city',
    location: { city: 'Foster City', coords: { lat: 37.5585, lng: -122.2711 } },
    duration: '2-3 Hours',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/4/48/Foster_City_February_2013_002.jpg',
    completed: true,
    notes: 'very dog friendly',
  },
  {
    id: 'coastal-sausalito',
    name: 'Coastal Sausalito',
    shortDescription:
      "Wander Sausalito's waterfront, houseboat harbors, and hillside streets across the Golden Gate from SF.",
    longDescription:
      "Spend a day exploring Sausalito's scenic waterfront — Bridgeway shops and cafes, the houseboat communities at Gate 5 and Gate 6½, ferry pier views back toward San Francisco, and the hillside lanes climbing into the Marin headlands. Pair with a ferry ride for a classic Bay Area outing.",
    category: 'scenic',
    region: 'north-bay',
    parkType: 'none',
    location: { city: 'Sausalito', coords: { lat: 37.8591, lng: -122.4853 } },
    duration: 'Full Day',
    difficulty: 'easy',
    dogFriendly: true,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/e0/Sausalito.jpg',
    completed: true,
    notes: 'dog friendly, but long day so might be tricky with dogs for lunch',
  },
  {
    id: 'billy-jones-railroad-holiday-lights',
    name: 'Billy Jones Wildcat Railroad Holiday Lights',
    shortDescription:
      'Ride the Billy Jones miniature steam railroad through a tunnel of holiday lights at Oak Meadow Park.',
    longDescription:
      'Each December, the Billy Jones Wildcat Railroad — a beloved ridable miniature steam train at Oak Meadow Park / Vasona in Los Gatos — runs evening Holiday Lights trips. The ride winds through Vasona Lake County Park past elaborate light displays, a charming local tradition for families.',
    category: 'culture',
    region: 'south-bay',
    parkType: 'county',
    location: { city: 'Los Gatos', coords: { lat: 37.2436, lng: -121.9722 } },
    duration: '1-2 Hours',
    durationDetail: 'Short evening ride plus park time',
    difficulty: 'easy',
    dogFriendly: false,
    coverImage:
      'https://upload.wikimedia.org/wikipedia/commons/e/ea/Billy_Jones_Railroad_in_Vasona_Lake_Park_%2825450475603%29.jpg',
    completed: true,
  },
];

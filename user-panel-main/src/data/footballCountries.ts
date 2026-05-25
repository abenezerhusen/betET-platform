// Complete A–Z list of football countries / international competitions used
// by the Left Sidebar(s). Country flags are served from flagcdn.com (free,
// supports gb-eng / gb-sct / gb-wls / gb-nir and Kosovo "xk").
//
// Shape:
//   { name, flag, leagues, count }
//
// `flag` is a URL. For continental / tournament entries that don't have a
// national flag (e.g. "Champions League", "World Cup"), a globe icon is used.

export interface FootballCountry {
  name: string;
  flag: string;
  leagues: string[];
  count: number;
}

const GLOBE = "https://ext.same-assets.com/1203561035/3182885345.svg";
const flag = (code: string) => `https://flagcdn.com/w40/${code}.png`;

export const footballCountries: FootballCountry[] = [
  // A
  { name: "Africa", flag: GLOBE, leagues: ["CAF Champions League", "CAF Confederation Cup", "Africa Cup of Nations"], count: 38 },
  { name: "Albania", flag: flag("al"), leagues: ["Kategoria Superiore", "Kategoria e Parë", "Albania Cup"], count: 16 },
  { name: "Algeria", flag: flag("dz"), leagues: ["Ligue Professionnelle 1", "Ligue 2", "Algeria Cup"], count: 28 },
  { name: "Andorra", flag: flag("ad"), leagues: ["Primera Divisió", "Copa Constitució"], count: 8 },
  { name: "Argentina", flag: flag("ar"), leagues: ["Primera División", "Primera Nacional", "Copa Argentina"], count: 34 },
  { name: "Armenia", flag: flag("am"), leagues: ["Premier League", "First League", "Armenia Cup"], count: 10 },
  { name: "Asia", flag: GLOBE, leagues: ["AFC Champions League", "AFC Cup", "AFC Asian Cup"], count: 42 },
  { name: "Australia", flag: flag("au"), leagues: ["A-League Men", "A-League Women", "Australia Cup"], count: 18 },
  { name: "Austria", flag: flag("at"), leagues: ["Bundesliga", "2. Liga", "ÖFB-Cup"], count: 20 },
  { name: "Azerbaijan", flag: flag("az"), leagues: ["Premier League", "First Division", "Azerbaijan Cup"], count: 12 },

  // B
  { name: "Bahrain", flag: flag("bh"), leagues: ["Premier League", "King's Cup"], count: 10 },
  { name: "Bangladesh", flag: flag("bd"), leagues: ["Premier League", "Federation Cup"], count: 8 },
  { name: "Belarus", flag: flag("by"), leagues: ["Premier League", "First League", "Belarusian Cup"], count: 14 },
  { name: "Belgium", flag: flag("be"), leagues: ["Jupiler Pro League", "Challenger Pro League", "Belgian Cup"], count: 26 },
  { name: "Benin", flag: flag("bj"), leagues: ["Ligue 1", "Ligue 2"], count: 6 },
  { name: "Bolivia", flag: flag("bo"), leagues: ["División Profesional", "Copa Bolivia"], count: 14 },
  { name: "Bosnia and Herzegovina", flag: flag("ba"), leagues: ["Premier League", "First League", "Bosnia Cup"], count: 12 },
  { name: "Botswana", flag: flag("bw"), leagues: ["Premier League", "FA Cup"], count: 8 },
  { name: "Brazil", flag: flag("br"), leagues: ["Série A", "Série B", "Série C", "Copa do Brasil"], count: 48 },
  { name: "Bulgaria", flag: flag("bg"), leagues: ["First League", "Second League", "Bulgarian Cup"], count: 16 },
  { name: "Burkina Faso", flag: flag("bf"), leagues: ["Premier League", "Coupe du Faso"], count: 6 },

  // C
  { name: "CAF Champions League", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 16 },
  { name: "Cameroon", flag: flag("cm"), leagues: ["Elite One", "Elite Two", "Cameroon Cup"], count: 10 },
  { name: "Canada", flag: flag("ca"), leagues: ["Canadian Premier League", "Canadian Championship"], count: 12 },
  { name: "Champions League", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 36 },
  { name: "Champions League Women", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 16 },
  { name: "Chile", flag: flag("cl"), leagues: ["Primera División", "Primera B", "Copa Chile"], count: 20 },
  { name: "China", flag: flag("cn"), leagues: ["Super League", "League One", "FA Cup"], count: 24 },
  { name: "Colombia", flag: flag("co"), leagues: ["Categoría Primera A", "Primera B", "Copa Colombia"], count: 22 },
  { name: "Copa America", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 12 },
  { name: "Copa America Women", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 8 },
  { name: "Copa Libertadores", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 18 },
  { name: "Costa Rica", flag: flag("cr"), leagues: ["Primera División", "Costa Rica Cup"], count: 12 },
  { name: "Croatia", flag: flag("hr"), leagues: ["HNL", "First NL", "Croatian Cup"], count: 14 },
  { name: "Cyprus", flag: flag("cy"), leagues: ["First Division", "Second Division", "Cypriot Cup"], count: 12 },
  { name: "Czech Republic", flag: flag("cz"), leagues: ["First League", "Second League", "Czech Cup"], count: 14 },

  // D
  { name: "Denmark", flag: flag("dk"), leagues: ["Superliga", "1st Division", "Danish Cup"], count: 18 },
  { name: "DR Congo", flag: flag("cd"), leagues: ["Linafoot", "DR Congo Cup"], count: 8 },

  // E
  { name: "Ecuador", flag: flag("ec"), leagues: ["LigaPro Serie A", "Serie B", "Copa Ecuador"], count: 14 },
  { name: "Egypt", flag: flag("eg"), leagues: ["Premier League", "Second Division", "Egypt Cup"], count: 20 },
  { name: "El Salvador", flag: flag("sv"), leagues: ["Primera División", "El Salvador Cup"], count: 10 },
  { name: "England", flag: flag("gb-eng"), leagues: ["Premier League", "Championship", "League One", "League Two", "FA Cup", "EFL Cup"], count: 195 },
  { name: "Estonia", flag: flag("ee"), leagues: ["Meistriliiga", "Esiliiga", "Estonian Cup"], count: 10 },
  { name: "Euro", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 24 },
  { name: "Euro U17", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 16 },
  { name: "Euro U17 Women", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 12 },
  { name: "Euro U19", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 14 },
  { name: "Euro U19 Women", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 10 },
  { name: "Euro U21", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 16 },
  { name: "Europa Conference League", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 24 },
  { name: "Europa League", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 32 },
  { name: "European Championships Women", flag: GLOBE, leagues: ["Qualifying", "Final Stage"], count: 16 },

  // F
  { name: "Faroe Islands", flag: flag("fo"), leagues: ["Effodeildin", "Faroe Islands Cup"], count: 8 },
  { name: "FIFA Club World Cup", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 14 },
  { name: "Finland", flag: flag("fi"), leagues: ["Veikkausliiga", "Ykkönen", "Finnish Cup"], count: 14 },
  { name: "France", flag: flag("fr"), leagues: ["Ligue 1", "Ligue 2", "National", "Coupe de France"], count: 93 },

  // G
  { name: "Gabon", flag: flag("ga"), leagues: ["Championnat National D1"], count: 6 },
  { name: "Georgia", flag: flag("ge"), leagues: ["Erovnuli Liga", "Erovnuli Liga 2", "Georgia Cup"], count: 12 },
  { name: "Germany", flag: flag("de"), leagues: ["Bundesliga", "2. Bundesliga", "3. Liga", "DFB-Pokal"], count: 89 },
  { name: "Ghana", flag: flag("gh"), leagues: ["Premier League", "Division One", "Ghana FA Cup"], count: 12 },
  { name: "Gibraltar", flag: flag("gi"), leagues: ["National League", "Gibraltar Cup"], count: 6 },
  { name: "Greece", flag: flag("gr"), leagues: ["Super League", "Super League 2", "Greek Cup"], count: 18 },
  { name: "Guatemala", flag: flag("gt"), leagues: ["Liga Nacional", "Primera División"], count: 10 },

  // H
  { name: "Honduras", flag: flag("hn"), leagues: ["Liga Nacional", "Liga de Ascenso"], count: 10 },
  { name: "Hong Kong", flag: flag("hk"), leagues: ["Premier League", "First Division"], count: 8 },
  { name: "Hungary", flag: flag("hu"), leagues: ["NB I", "NB II", "Magyar Kupa"], count: 14 },

  // I
  { name: "Iceland", flag: flag("is"), leagues: ["Úrvalsdeild", "1. deild", "Iceland Cup"], count: 10 },
  { name: "India", flag: flag("in"), leagues: ["Indian Super League", "I-League", "Super Cup"], count: 18 },
  { name: "Indonesia", flag: flag("id"), leagues: ["Liga 1", "Liga 2", "Indonesia Cup"], count: 16 },
  { name: "International", flag: GLOBE, leagues: ["Friendlies", "Qualifiers"], count: 32 },
  { name: "Iran", flag: flag("ir"), leagues: ["Persian Gulf Pro League", "Azadegan League", "Hazfi Cup"], count: 16 },
  { name: "Iraq", flag: flag("iq"), leagues: ["Stars League", "Iraq Cup"], count: 10 },
  { name: "Ireland", flag: flag("ie"), leagues: ["Premier Division", "First Division", "FAI Cup"], count: 12 },
  { name: "Israel", flag: flag("il"), leagues: ["Premier League", "Leumit League", "State Cup"], count: 14 },
  { name: "Italy", flag: flag("it"), leagues: ["Serie A", "Serie B", "Serie C", "Coppa Italia"], count: 157 },

  // J
  { name: "Jamaica", flag: flag("jm"), leagues: ["Premier League", "Jamaica Cup"], count: 8 },
  { name: "Japan", flag: flag("jp"), leagues: ["J1 League", "J2 League", "J3 League", "Emperor's Cup"], count: 30 },
  { name: "Jordan", flag: flag("jo"), leagues: ["Pro League", "First Division"], count: 10 },

  // K
  { name: "Kazakhstan", flag: flag("kz"), leagues: ["Premier League", "First League", "Kazakhstan Cup"], count: 12 },
  { name: "Kenya", flag: flag("ke"), leagues: ["Premier League", "Super League"], count: 10 },
  { name: "Kosovo", flag: flag("xk"), leagues: ["Superliga", "First League", "Kosovo Cup"], count: 10 },
  { name: "Kuwait", flag: flag("kw"), leagues: ["Premier League", "Emir Cup"], count: 10 },

  // L
  { name: "Latvia", flag: flag("lv"), leagues: ["Virsliga", "1. liga", "Latvian Cup"], count: 10 },
  { name: "Lebanon", flag: flag("lb"), leagues: ["Premier League", "Lebanon Cup"], count: 10 },
  { name: "Libya", flag: flag("ly"), leagues: ["Premier League"], count: 6 },
  { name: "Liechtenstein", flag: flag("li"), leagues: ["Liechtenstein Cup"], count: 4 },
  { name: "Lithuania", flag: flag("lt"), leagues: ["A Lyga", "1 Lyga", "Lithuania Cup"], count: 10 },
  { name: "Luxembourg", flag: flag("lu"), leagues: ["National Division", "Luxembourg Cup"], count: 8 },

  // M
  { name: "Malaysia", flag: flag("my"), leagues: ["Super League", "Premier League", "Malaysia FA Cup"], count: 14 },
  { name: "Malta", flag: flag("mt"), leagues: ["Premier League", "Challenge League", "FA Trophy"], count: 10 },
  { name: "Mexico", flag: flag("mx"), leagues: ["Liga MX", "Liga de Expansión MX", "Copa MX"], count: 32 },
  { name: "Moldova", flag: flag("md"), leagues: ["Super Liga", "Liga 1", "Moldovan Cup"], count: 10 },
  { name: "Montenegro", flag: flag("me"), leagues: ["First League", "Second League", "Montenegrin Cup"], count: 10 },
  { name: "Morocco", flag: flag("ma"), leagues: ["Botola Pro", "Botola 2", "Throne Cup"], count: 18 },

  // N
  { name: "Netherlands", flag: flag("nl"), leagues: ["Eredivisie", "Eerste Divisie", "KNVB Cup"], count: 32 },
  { name: "New Zealand", flag: flag("nz"), leagues: ["National League", "Chatham Cup"], count: 8 },
  { name: "Niger", flag: flag("ne"), leagues: ["Premier League"], count: 6 },
  { name: "Nigeria", flag: flag("ng"), leagues: ["NPFL", "NNL", "Federation Cup"], count: 14 },
  { name: "North America", flag: GLOBE, leagues: ["CONCACAF Champions Cup", "Gold Cup"], count: 18 },
  { name: "North Macedonia", flag: flag("mk"), leagues: ["First League", "Second League", "Macedonian Cup"], count: 10 },
  { name: "Northern Ireland", flag: flag("gb-nir"), leagues: ["Premiership", "Championship", "Irish Cup"], count: 14 },
  { name: "Norway", flag: flag("no"), leagues: ["Eliteserien", "OBOS-ligaen", "Norwegian Cup"], count: 20 },

  // O
  { name: "Olympics", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 16 },
  { name: "Olympics Women", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 12 },
  { name: "Oman", flag: flag("om"), leagues: ["Professional League", "Sultan Cup"], count: 10 },

  // P
  { name: "Paraguay", flag: flag("py"), leagues: ["División Profesional", "División Intermedia", "Copa Paraguay"], count: 14 },
  { name: "Peru", flag: flag("pe"), leagues: ["Liga 1", "Liga 2", "Copa Bicentenario"], count: 16 },
  { name: "Poland", flag: flag("pl"), leagues: ["Ekstraklasa", "I Liga", "Polish Cup"], count: 20 },
  { name: "Portugal", flag: flag("pt"), leagues: ["Primeira Liga", "Liga Portugal 2", "Taça de Portugal"], count: 39 },

  // Q
  { name: "Qatar", flag: flag("qa"), leagues: ["Stars League", "Emir Cup"], count: 12 },

  // R
  { name: "Romania", flag: flag("ro"), leagues: ["SuperLiga", "Liga II", "Cupa României"], count: 18 },
  { name: "Russia", flag: flag("ru"), leagues: ["Premier League", "First League", "Russian Cup"], count: 28 },

  // S
  { name: "San Marino", flag: flag("sm"), leagues: ["Campionato Sammarinese", "Coppa Titano"], count: 4 },
  { name: "Saudi Arabia", flag: flag("sa"), leagues: ["Pro League", "First Division League", "King's Cup"], count: 24 },
  { name: "Scotland", flag: flag("gb-sct"), leagues: ["Premiership", "Championship", "League One", "League Two", "Scottish Cup"], count: 28 },
  { name: "Serbia", flag: flag("rs"), leagues: ["SuperLiga", "Prva Liga", "Serbian Cup"], count: 16 },
  { name: "Singapore", flag: flag("sg"), leagues: ["Premier League", "Singapore Cup"], count: 8 },
  { name: "Slovakia", flag: flag("sk"), leagues: ["Super Liga", "2. Liga", "Slovak Cup"], count: 12 },
  { name: "Slovenia", flag: flag("si"), leagues: ["PrvaLiga", "2. SNL", "Slovenian Cup"], count: 12 },
  { name: "South Africa", flag: flag("za"), leagues: ["Premier Division", "First Division", "Nedbank Cup"], count: 18 },
  { name: "South America", flag: GLOBE, leagues: ["CONMEBOL Qualifiers"], count: 12 },
  { name: "South Korea", flag: flag("kr"), leagues: ["K League 1", "K League 2", "Korean FA Cup"], count: 22 },
  { name: "Spain", flag: flag("es"), leagues: ["La Liga", "La Liga 2", "Primera RFEF", "Copa del Rey"], count: 185 },
  { name: "Sudan", flag: flag("sd"), leagues: ["Premier League"], count: 6 },
  { name: "Sweden", flag: flag("se"), leagues: ["Allsvenskan", "Superettan", "Svenska Cupen"], count: 20 },
  { name: "Switzerland", flag: flag("ch"), leagues: ["Super League", "Challenge League", "Swiss Cup"], count: 16 },
  { name: "Syria", flag: flag("sy"), leagues: ["Premier League", "Syria Cup"], count: 8 },

  // T
  { name: "Taiwan", flag: flag("tw"), leagues: ["Premier League"], count: 6 },
  { name: "Tanzania", flag: flag("tz"), leagues: ["Premier League"], count: 8 },
  { name: "Thailand", flag: flag("th"), leagues: ["Thai League 1", "Thai League 2", "Thai FA Cup"], count: 16 },
  { name: "Tunisia", flag: flag("tn"), leagues: ["Ligue Professionnelle 1", "Ligue Professionnelle 2", "Tunisian Cup"], count: 14 },
  { name: "Turkiye", flag: flag("tr"), leagues: ["Süper Lig", "1. Lig", "2. Lig", "Turkish Cup"], count: 26 },

  // U
  { name: "UAE", flag: flag("ae"), leagues: ["Pro League", "First Division", "President's Cup"], count: 14 },
  { name: "UEFA Nations League", flag: GLOBE, leagues: ["League A", "League B", "League C", "League D"], count: 28 },
  { name: "UEFA Nations League Women", flag: GLOBE, leagues: ["League A", "League B", "League C"], count: 20 },
  { name: "Uganda", flag: flag("ug"), leagues: ["Premier League", "Uganda Cup"], count: 8 },
  { name: "Ukraine", flag: flag("ua"), leagues: ["Premier League", "First League", "Ukrainian Cup"], count: 16 },
  { name: "Uruguay", flag: flag("uy"), leagues: ["Primera División", "Segunda División", "Copa Uruguay"], count: 14 },
  { name: "USA", flag: flag("us"), leagues: ["MLS", "USL Championship", "US Open Cup"], count: 28 },
  { name: "Uzbekistan", flag: flag("uz"), leagues: ["Super League", "Pro League", "Uzbekistan Cup"], count: 12 },

  // V
  { name: "Venezuela", flag: flag("ve"), leagues: ["Primera División", "Segunda División", "Copa Venezuela"], count: 12 },
  { name: "Vietnam", flag: flag("vn"), leagues: ["V.League 1", "V.League 2", "National Cup"], count: 12 },

  // W
  { name: "Wales", flag: flag("gb-wls"), leagues: ["Cymru Premier", "Welsh Cup"], count: 10 },
  { name: "World Cup", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage", "Final"], count: 32 },
  { name: "World Cup U17", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 24 },
  { name: "World Cup U20", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 24 },
  { name: "World Cup Women", flag: GLOBE, leagues: ["Group Stage", "Knockout Stage"], count: 32 },

  // Z
  { name: "Zambia", flag: flag("zm"), leagues: ["Super League", "Zambia Cup"], count: 8 },
  { name: "Zimbabwe", flag: flag("zw"), leagues: ["Premier Soccer League", "Zimbabwe Cup"], count: 8 },
];

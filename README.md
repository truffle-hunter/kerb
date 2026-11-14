# Kerb

Which Dublin taxi rank to head for now: the stands that are legal right now, the road distance, where demand is likely and why, and what's coming in the next hour. It is an offline web app: open it on your phone and use **Add to Home Screen** (iPhone, Safari) or **Install app** (Android, Chrome).

**Live:** https://truffle-hunter.github.io/kerb/

This repository holds only the published app: static files, data bundle `85599fd9dedd`. There are no wait times in minutes: nobody has measured waits at Dublin ranks yet, so Kerb shows likely demand, never minutes.

## Data and licences
- Stand locations come from Dublin City Council's Taxi Bye-Laws 2015 (all four schedules), placed on the map from open data. None has been checked at the kerb.
- Map and road network: © OpenStreetMap contributors, ODbL. `data/graph.json` and `data/streets.json` are derived databases under the ODbL.
- Timetables: Transport for Ireland GTFS (CC BY 4.0). Ferries: Dublin Port 2026 slot times.
- Rain: Met Éireann forecast (CC BY 4.0).
- Pubs and nightclubs: Tailte Éireann valuation list (CC BY 4.0). Hotel rooms: Fáilte Ireland accommodation register (CC BY 4.0).

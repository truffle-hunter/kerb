# Kerb

Which Dublin taxi rank to head for now: the stands that are legal right now, the road distance, where demand is likely and why, and what's coming in the next hour. It is an offline web app: open it on your phone and use **Add to Home Screen** (iPhone, Safari) or **Install app** (Android, Chrome).

**Live:** https://truffle-hunter.github.io/kerb/

This repository holds only the published app: static files, data bundle `970eb73e6a17`. There are no wait times in minutes: nobody has measured waits at Dublin ranks yet, so Kerb shows likely demand, never minutes.

## Data and licences
- Stand locations come from Dublin City Council's Taxi Bye-Laws 2015 (all four schedules), placed on the map from open data. None has been checked at the kerb.
- Map and road network: © OpenStreetMap contributors, ODbL. `data/graph.json`, `data/streets.json` and `data/mapctx.json` are derived databases under the ODbL.
- Timetables: Transport for Ireland GTFS (CC BY 4.0). Ferries: Dublin Port 2026 slot times.
- Rain: Met Éireann forecast (CC BY 4.0).
- Pubs and nightclubs: Tailte Éireann valuation list (CC BY 4.0). Hotel rooms: Fáilte Ireland accommodation register (CC BY 4.0).

## Street photos

Each photo comes from Panoramax. The crops below (reprojected from 360° photos to a flat view) and resizes are adaptations, shared under the same licence as their source: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) or Licence Ouverte 2.0 (https://www.etalab.gouv.fr/licence-ouverte-open-licence). Faces and number plates were blurred by Panoramax. Each photo was checked by AI reviewers, not a person.

- `photos/NC_dublin-port-terminal-1-irish-ferries-6ef526c8.jpg`: Pierre Beyssac, 2025-05-03, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=c42aba6f-a3b7-4b54-8a69-cb99721af9fe). Resized.
- `photos/S1-100-11bd71d6.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=764514b8-8537-442d-9f50-7fd5fcc8a30a). Cropped from a 360° photo.
- `photos/S1-102-3dfdac5c.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=4eec93b1-81bc-43b8-9389-a57460c52dbf). Cropped from a 360° photo.
- `photos/S1-19-cd417a27.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=c0e42284-2b0a-45d3-81d7-ccffc8a758c7). Cropped from a 360° photo.
- `photos/S1-20-6be546d4.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=4e3d6329-d0bf-488d-b5c4-5fbecba9d8c7). Cropped from a 360° photo.
- `photos/S1-21-d583334a.jpg`: Pierre Beyssac, 2025-08-30, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=3825f6e7-3b25-4414-a532-a95dd1036e5f). Resized.
- `photos/S1-30-900c50ad.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=6a386bcf-03cc-4139-b7b6-68205ba07a60). Cropped from a 360° photo.
- `photos/S1-33-421314aa.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=ad02a8da-c72f-4902-93bb-1b7f5f8715ca). Cropped from a 360° photo.
- `photos/S1-5-a63c53ab.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=9bc7d9f1-8667-48b9-8feb-728d01b2e0bd). Cropped from a 360° photo.
- `photos/S1-71-2b973632.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=fb51f669-1c51-4a23-a340-ec32e485e445). Cropped from a 360° photo.
- `photos/S1-86-c0cf4324.jpg`: b-unicycling, 2025-02-19, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=a0dc9b2d-f3e4-414f-a8fe-10792eae7226). Resized.
- `photos/S1-90-e6a53db4.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=b1e32706-6d58-4b75-94b8-f01c6da4258f). Cropped from a 360° photo.
- `photos/S2-10-a74aa42f.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=d3bb290d-f473-43fd-8a4a-19779082101d). Cropped from a 360° photo.
- `photos/S2-11-e8701fce.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=a0839c4f-f7aa-4b97-aa9c-1964abadaf81). Cropped from a 360° photo.
- `photos/S2-16-e579698b.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=6069ea89-d4d7-4225-8a68-2eaf77e1cea7). Cropped from a 360° photo.
- `photos/S2-18-64eb82dd.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=e041d480-8281-49de-ab84-a0e024714822). Cropped from a 360° photo.
- `photos/S2-22-112473e5.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=71cb3fe3-eeff-4785-9ca2-49f891a508af). Cropped from a 360° photo.
- `photos/S2-24-57dedfdd.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=09cb67d8-ce08-44cc-a122-a7dde7546c50). Cropped from a 360° photo.
- `photos/S2-25-d0cef402.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=a8f3da10-1fcb-418e-94fa-24d079e6ca33). Cropped from a 360° photo.
- `photos/S2-26-d8b259c8.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=c837fcef-b83c-4036-9845-b7d616fae84b). Cropped from a 360° photo.
- `photos/S2-29-b80cc89c.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=e50f3903-87b3-4895-9588-49cfe39b3faf). Cropped from a 360° photo.
- `photos/S2-30-91a77fb1.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=49359d28-1205-4259-90a7-0d1ab33cb3c4). Cropped from a 360° photo.
- `photos/S2-5-d24ba305.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=8dc67c52-4f55-40e7-bf6a-04a3183ce0d1). Cropped from a 360° photo.
- `photos/S2-54-27ab2476.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=d06faef4-0c1e-4851-a77a-f3631cbb5d42). Cropped from a 360° photo.
- `photos/S2-55-63bb64d7.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=8ffc9fbd-36ef-4b55-a141-959512225768). Cropped from a 360° photo.
- `photos/S2-9-5fa190f7.jpg`: Pierre Beyssac, 2026-04-23, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [source](https://panoramax.openstreetmap.fr/#focus=pic&pic=ad270d0b-35ac-4da6-b125-82e39122d890). Cropped from a 360° photo.

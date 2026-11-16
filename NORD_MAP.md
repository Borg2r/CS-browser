# NORD Datacenter

This operation is based on the user-supplied
`NORD_Datacenter_Completo_v12_IFC4.ifc`, extracted from its ZIP upload. Its IFC4
spatial structure, room extents, equipment bounds and surface colours were
inspected with IfcOpenShell. The game uses purpose-built geometry derived from
that analysis, so players do not download the 125 MB BIM source.

## Reference retained

The source identifies the building as **NORD DC-02**, a demonstration data
centre. Coordinates below use its original metre-based IFC XY ground plane.

| Source feature | Source arrangement | Game adaptation |
| --- | --- | --- |
| Main building | 32 × 24 m | Same rectangular footprint and room hierarchy, enlarged horizontally |
| Operational data hall | West side, about 18.55 × 16.65 m | Main server hall with 48 collidable cabinets |
| Rack rows | R1–R4, 12 cabinets in each row | Four rows, retained cabinet groups and cross aisles |
| Technical corridor | Between the data hall and eastern plant rooms | A continuous route linking the technical rooms |
| UPS A, UPS B, electrical distribution, pump room | Four rooms stacked along the east side | Distinct power and cooling spaces with equipment cover |
| Reception, loading, workshop, security | Front support strip | Connected entrances and support rooms; small service spaces simplified |
| South annex | 32 × 14 m, future hall west and staff lounge east | Separate annex routes and recognisable room uses |
| External plant | East of the building: two chillers and two generators | Equipment yard with solid cover and a flanking route |
| Material palette | Blue-grey structure, dark server enclosures, cyan/blue/red services, wood furniture | Matching procedural materials, pipes, cable trays and furnishings |

## Playable geometry

The coordinate transform is `game X = 2 × (IFC X − 22)` and
`game Z = 2 × (12 − IFC Y)`. The horizontal enlargement provides usable space
for two teams, collision margins and bot navigation while retaining the
building's arrangement. Vertical dimensions are adapted separately.

The playable routes are on one continuous ground plane. The raised server
floor is flattened; the office storey and maintenance stairs are not additional
playable floors. Door openings and circulation are widened, small utility
spaces are simplified, and protected spawn courts are added outside the
original building. These changes make this a tactical adaptation rather than
a full-scale IFC viewer.

The Rust map owns walls, ceilings, server cabinets and major equipment
collision. Client decoration follows those bounds; narrow trim, lights, labels
and overhead services add detail without creating new ground-level obstacles.
The same collision map is compiled into the server and prediction WASM.

Site A occupies the operational hall's eastern service aisle. Site B is in the
future expansion hall. The entry approaches use the front support rooms, west
service lane, technical corridor and east plant yard to provide alternate
routes around the rack banks and interior partitions.

## Verification

The shared map tests check connected walkable areas, reachable bomb sites,
clear spawn facing and protection against direct and penetrating spawn shots.
Server tests check bot routes and authoritative map transitions.
`node scripts/maps-smoke.mjs http://127.0.0.1:PORT` checks all five maps with
guest clients, including native/WASM collision agreement and host controls.

The original IFC and analysis files are kept outside the repository and the
deployed game. The runtime needs no IFC parsing library or external assets.

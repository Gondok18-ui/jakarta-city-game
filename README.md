# Jakarta City

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) [![rank](https://make.fun/badge/gta6-01/Gondok18-ui/jakarta-city-game/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) [![reward](https://make.fun/badge/gta6-01/Gondok18-ui/jakarta-city-game/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Jakarta City is a complete open-world crime game set in a stylized Jakarta — the Thamrin–Sudirman avenue, the Bundaran HI roundabout and the Monas monument — built with three.js and plain static files. Explore on foot or steal any car, bus, angkot or bajaj in flowing traffic that obeys working traffic lights; pedestrians cross at zebra crossings, sit on benches, walk in pairs and duck into shophouses. Commit crimes and the police respond with a five-star wanted system: intercept pursuit, officers who park, get out and shoot, and roadblocks at the highest level. Earn money with delivery and ride-hail missions, heal at food stalls, and get your car repaired and your heat cleared at the workshop. A full day/night cycle lights the tower windows and street lamps after dark, and your progress autosaves — pick up where you left off with Continue.

## Run it

Serve the `game/` folder with any static file server and open it in a desktop browser:

```
npx serve game
```

or, with the file included in this repo:

```
node serve.ts
```

then open http://localhost:8080. No build step and no network access are needed — three.js is vendored under `game/vendor/three/`.

<sub>Entered on [make.fun](https://make.fun/?ref=d6b9q93n&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

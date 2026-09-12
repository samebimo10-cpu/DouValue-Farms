# Brand assets

`logo-original.jpg` is the logo as supplied by DouValue Farms Limited: the full
square with its black frame.

The files the app actually ships are derived from it and live in `../web/img/`:

| File | What it is | Used by |
|---|---|---|
| `logo.jpg` / `logo.webp` | Wordmark and leaf, cropped to the artwork | Sign-in and setup screens |
| `mark.jpg` | The leaf alone, square | The bar across the top of every screen |
| `mark-192.png`, `mark-512.jpg` | The leaf alone, app-icon sizes | Home-screen icon, install prompt |
| `../icon.svg` | A vector redrawing of the leaf | Browser tab, where a photo turns to mush at 16px |

Keep this original. If the logo is ever re-cropped or re-exported, it is the source.

The palette in `../web/css/app.css` is taken from it: navy `#16305c` from the
wordmark, blue `#1b7fc4` and `#2ba9e0` from the data half of the leaf, green
`#2e9b4e` and `#7fc241` from the living half. The button green is darkened to
`#1b7a42` so white text on it stays readable in direct sun.

// Gerado por scripts/prepare-kito-pixel.mjs a partir de art-source/kito-pixel/. Não editar à mão.
export const kitoSprites = {
  "atlas": "/media/hero/kito-pixel-atlas.webp",
  "pose": "/media/hero/kito-pixel-pose.webp",
  "cell": 256,
  "columns": 8,
  "rows": 8,
  "animations": {
    "front": {
      "start": 0,
      "count": 1,
      "ground": 232
    },
    "frontSide": {
      "start": 1,
      "count": 1,
      "ground": 237
    },
    "side": {
      "start": 2,
      "count": 1,
      "ground": 237
    },
    "walk": {
      "start": 3,
      "count": 8,
      "ground": 238
    },
    "run": {
      "start": 11,
      "count": 8,
      "ground": 237
    },
    "sprint": {
      "start": 19,
      "count": 8,
      "ground": 233
    },
    "jump": {
      "start": 27,
      "count": 7,
      "ground": 232
    },
    "fall": {
      "start": 34,
      "count": 9,
      "ground": 237
    },
    "push": {
      "start": 43,
      "count": 6,
      "ground": 237
    },
    "sit": {
      "start": 49,
      "count": 1,
      "ground": 231
    },
    "play": {
      "start": 50,
      "count": 1,
      "ground": 240
    },
    "love": {
      "start": 51,
      "count": 1,
      "ground": 231
    },
    "carry": {
      "start": 52,
      "count": 5,
      "ground": 0,
      "angles": [
        -16,
        -8,
        0,
        8,
        16
      ],
      "grab": [
        [
          106,
          52
        ],
        [
          117,
          49
        ],
        [
          128,
          49
        ],
        [
          139,
          49
        ],
        [
          150,
          52
        ]
      ],
      "feet": [
        242,
        238,
        231,
        236,
        240
      ]
    }
  }
} as const

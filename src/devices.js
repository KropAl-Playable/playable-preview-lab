function twoViewProfile(id, name, kind, width, height, dpr) {
  return {
    id, name, kind,
    views: [
      { id: 'primary-portrait', label: 'Portrait', width, height, dpr, orientation: 'portrait' },
      { id: 'primary-landscape', label: 'Landscape', width: height, height: width, dpr, orientation: 'landscape' },
    ],
  };
}

export const DEVICE_PROFILES = [
  twoViewProfile('iphone-se', 'iPhone SE', 'phone', 375, 667, 2),
  twoViewProfile('iphone-8-plus', 'iPhone 8 Plus', 'phone', 414, 736, 3),
  twoViewProfile('iphone-13', 'iPhone 13 / 14', 'phone', 390, 844, 3),
  twoViewProfile('iphone-15-pro-max', 'iPhone 15 Pro Max', 'phone', 430, 932, 3),
  twoViewProfile('galaxy-s8', 'Galaxy S8', 'phone', 360, 740, 3),
  twoViewProfile('galaxy-s20', 'Galaxy S20', 'phone', 360, 800, 3),
  twoViewProfile('pixel-7', 'Pixel 7', 'phone', 412, 915, 2.625),
  twoViewProfile('small-android', 'Small Android', 'phone', 320, 568, 2),
  twoViewProfile('ipad-mini', 'iPad mini', 'tablet', 768, 1024, 2),
  twoViewProfile('ipad-10', 'iPad 10.2 / 10.9', 'tablet', 810, 1080, 2),
  twoViewProfile('ipad-pro-11', 'iPad Pro 11', 'tablet', 834, 1194, 2),
  twoViewProfile('galaxy-tab', 'Galaxy Tab', 'tablet', 800, 1280, 2),
  {
    id: 'galaxy-z-fold5',
    name: 'Galaxy Z Fold5',
    kind: 'foldable',
    note: 'Four-view QA profile: cover + main display. CSS viewport values are a preview approximation.',
    views: [
      { id: 'primary-portrait', label: 'Folded · Portrait', width: 301, height: 772, dpr: 3, orientation: 'portrait', surface: 'cover' },
      { id: 'primary-landscape', label: 'Folded · Landscape', width: 772, height: 301, dpr: 3, orientation: 'landscape', surface: 'cover' },
      { id: 'secondary-portrait', label: 'Open · Portrait', width: 604, height: 725, dpr: 3, orientation: 'portrait', surface: 'main' },
      { id: 'secondary-landscape', label: 'Open · Landscape', width: 725, height: 604, dpr: 3, orientation: 'landscape', surface: 'main' },
    ],
  },
];

// Backwards-compatible alias while the preview lab is being refactored.
export const DEVICES = DEVICE_PROFILES;

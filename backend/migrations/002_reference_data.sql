-- Reference data only (cities, categories, platform settings). No users, shops, products or orders are seeded.

insert into cities (slug, name, state, is_active) values
  ('sivakasi', 'Sivakasi', 'Tamil Nadu', true);

insert into categories (slug, name_en, name_ta, name_hi, sort_order) values
  ('sparklers',       'Sparklers',       'கம்பி மத்தாப்பு',      'फुलझड़ी',          1),
  ('flower-pots',     'Flower Pots',     'பூந்தொட்டி',           'अनार (फ्लावर पॉट)', 2),
  ('ground-chakkars', 'Ground Chakkars', 'தரை சக்கரம்',          'ज़मीन चक्री',        3),
  ('wheels',          'Wheels',          'சுழல் சக்கரம்',         'व्हील',             4),
  ('rockets',         'Rockets',         'ராக்கெட்',             'रॉकेट',            5),
  ('fountains',       'Fountains',       'நீரூற்று வெடி',         'फाउंटेन',           6),
  ('twinkling-stars', 'Twinkling Stars', 'டிவிங்கிளிங் ஸ்டார்',   'ट्विंकलिंग स्टार',   7),
  ('colour-matches',  'Colour Matches',  'வண்ண தீப்பெட்டி',      'कलर माचिस',         8),
  ('gift-boxes',      'Gift Boxes',      'கிஃப்ட் பாக்ஸ்',        'गिफ्ट बॉक्स',        9),
  ('combo-boxes',     'Combo Boxes',     'காம்போ பாக்ஸ்',         'कॉम्बो बॉक्स',       10),
  ('family-packs',    'Family Packs',    'குடும்ப பேக்',          'फैमिली पैक',         11);

insert into settings (key, value) values
  ('commission_bps',          '500'),       -- 5%
  ('subscription_paise',      '19900'),     -- ₹199
  ('subscription_months',     '6'),
  ('min_customer_age',        '18'),
  ('checkout_enabled',        'true'),      -- platform kill-switch (legal/compliance)
  ('delivery_enabled',        'false'),     -- seller delivery only when admin enables where legally permitted
  ('order_hold_minutes',      '15'),        -- stock reservation window during payment
  ('support_phone',           '""'),
  ('support_email',           '""'),
  ('app_version',             '"1.0.0"');

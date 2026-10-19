-- Abuja police divisions sourced online (October 2026). Positions are approximate district centres, used only to pick
-- the nearest division; numbers are as published and should be confirmed by phone (Platform -> Police stations -> Verified).
INSERT INTO "police_stations" ("name", "area", "address", "phone", "alt_phone", "latitude", "longitude", "source") VALUES
    ('Maitama Police Division', 'Maitama', '30 Nile Street, off Alvan Ikoku Way, Maitama', '+2348038485123', NULL, 9.085, 7.496, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Central Police Station', 'Central Area', 'Central Area, Abuja', '+2348033568389', NULL, 9.054, 7.489, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Garki Police Division', 'Garki', 'Garki II, Abuja', '+2348033560903', NULL, 9.028, 7.488, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Wuse Police Division', 'Wuse', 'Wuse Zone 3, Abuja', '+2348053088102', NULL, 9.072, 7.476, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Asokoro Police Division', 'Asokoro', 'Asokoro, Abuja', '+2347028134449', NULL, 9.042, 7.525, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Utako Police Division', 'Utako', '7 Osissogou Crescent, Utako', '+2347055888119', '+2347038621264', 9.069, 7.442, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Karmo Police Division', 'Karmo', 'Karmo, Abuja', '+2348033773129', NULL, 9.056, 7.383, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Lugbe Police Division', 'Lugbe', 'Airport Road, Lugbe', '+2348037882321', '+2348054967585', 8.978, 7.373, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Life Camp Police Division', 'Life Camp', 'Life Camp, Gwarinpa', '+2348058036613', NULL, 9.078, 7.405, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Gwarinpa Police Division', 'Gwarinpa', 'Gwarinpa, Abuja', '+2348059113555', NULL, 9.105, 7.41, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Kubwa Police Division', 'Kubwa', 'Kubwa, Abuja', '+2348036134478', NULL, 9.155, 7.325, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Byazhin Police Division', 'Byazhin, Kubwa', 'Gado Nasko, beside Chosen Church, Byazhin, Kubwa', NULL, NULL, 9.137, 7.335, 'No direct line published; alerts fall back to the FCT Command emergency lines'),
    ('Dutse Alhaji Police Division', 'Dutse Alhaji', 'Dutse Alhaji, Bwari Area Council', '+2348053089999', NULL, 9.165, 7.43, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express)'),
    ('Bwari Police Division', 'Bwari', 'Bwari town', '+2348075804475', NULL, 9.281, 7.38, 'FCT Police Command division lines, July 2022 (reported by Kubwa Express); the same number is listed for Zuba elsewhere'),
    ('Gwagwalada Police Division', 'Gwagwalada', 'Specialist Hospital Road, Gwagwalada', '+2348057467369', NULL, 8.942, 7.083, 'Abuja police directory listing (abujacity.com / finelib.com); unconfirmed'),
    ('Nyanya Police Division', 'Nyanya', 'Nyanya, Abuja', '+2348046115181', NULL, 9.015, 7.565, 'Abuja police directory listing (abujacity.com / finelib.com); unconfirmed'),
    ('Karu Police Division', 'Karu', 'Karu, Abuja', '+2348036249825', NULL, 9.012, 7.548, 'Abuja police directory listing (abujacity.com / finelib.com); unconfirmed'),
    ('Kuje Police Division', 'Kuje', 'Kuje town', '+2347030800531', NULL, 8.879, 7.228, 'Abuja police directory listing (abujacity.com / finelib.com); unconfirmed');

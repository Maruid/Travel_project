// 세계 주요 공항 (입력 자동 추천용). value = 칸에 들어가는 글, label = 추천 목록에서 같이 검색되는 글
const A = [
  // 한국
  ['인천', 'ICN', 'Incheon Seoul 서울'], ['김포', 'GMP', 'Gimpo Seoul 서울'], ['김해', 'PUS', 'Gimhae Busan 부산'],
  ['제주', 'CJU', 'Jeju'], ['대구', 'TAE', 'Daegu'], ['청주', 'CJJ', 'Cheongju'], ['무안', 'MWX', 'Muan'],
  // 일본
  ['간사이', 'KIX', 'Kansai Osaka 오사카'], ['오사카 이타미', 'ITM', 'Itami Osaka'], ['나리타', 'NRT', 'Narita Tokyo 도쿄'],
  ['하네다', 'HND', 'Haneda Tokyo 도쿄'], ['나고야 주부', 'NGO', 'Chubu Nagoya'], ['후쿠오카', 'FUK', 'Fukuoka'],
  ['신치토세 삿포로', 'CTS', 'New Chitose Sapporo'], ['나하 오키나와', 'OKA', 'Naha Okinawa'], ['고베', 'UKB', 'Kobe'],
  ['히로시마', 'HIJ', 'Hiroshima'], ['센다이', 'SDJ', 'Sendai'], ['가고시마', 'KOJ', 'Kagoshima'],
  // 중화권
  ['타오위안 타이베이', 'TPE', 'Taoyuan Taipei 대만'], ['송산 타이베이', 'TSA', 'Songshan Taipei'], ['가오슝', 'KHH', 'Kaohsiung'],
  ['홍콩', 'HKG', 'Hong Kong'], ['마카오', 'MFM', 'Macau'], ['베이징 서우두', 'PEK', 'Beijing Capital'],
  ['베이징 다싱', 'PKX', 'Beijing Daxing'], ['상하이 푸둥', 'PVG', 'Shanghai Pudong'], ['상하이 훙차오', 'SHA', 'Shanghai Hongqiao'],
  ['광저우', 'CAN', 'Guangzhou'], ['선전', 'SZX', 'Shenzhen'], ['청두', 'TFU', 'Chengdu'],
  // 동남아
  ['방콕 수완나품', 'BKK', 'Suvarnabhumi Bangkok 태국'], ['방콕 돈므앙', 'DMK', 'Don Mueang Bangkok'], ['푸껫', 'HKT', 'Phuket'],
  ['치앙마이', 'CNX', 'Chiang Mai'], ['싱가포르 창이', 'SIN', 'Changi Singapore'], ['쿠알라룸푸르', 'KUL', 'Kuala Lumpur 말레이시아'],
  ['코타키나발루', 'BKI', 'Kota Kinabalu'], ['하노이 노이바이', 'HAN', 'Hanoi Noi Bai 베트남'], ['호치민 탄손누트', 'SGN', 'Ho Chi Minh Tan Son Nhat'],
  ['다낭', 'DAD', 'Da Nang'], ['나트랑 캄란', 'CXR', 'Cam Ranh Nha Trang'], ['푸꾸옥', 'PQC', 'Phu Quoc'],
  ['마닐라', 'MNL', 'Manila 필리핀'], ['세부 막탄', 'CEB', 'Cebu Mactan'], ['자카르타', 'CGK', 'Jakarta 인도네시아'],
  ['발리 응우라라이', 'DPS', 'Bali Denpasar'], ['시엠립', 'SAI', 'Siem Reap'], ['프놈펜', 'PNH', 'Phnom Penh'],
  // 서남아·중동
  ['델리', 'DEL', 'Delhi 인도'], ['뭄바이', 'BOM', 'Mumbai'], ['두바이', 'DXB', 'Dubai UAE'], ['아부다비', 'AUH', 'Abu Dhabi'],
  ['도하', 'DOH', 'Doha Qatar 카타르'], ['이스탄불', 'IST', 'Istanbul 튀르키예 터키'], ['텔아비브', 'TLV', 'Tel Aviv'],
  // 유럽
  ['런던 히스로', 'LHR', 'London Heathrow 영국'], ['런던 개트윅', 'LGW', 'London Gatwick'], ['파리 샤를드골', 'CDG', 'Paris Charles de Gaulle 프랑스'],
  ['파리 오를리', 'ORY', 'Paris Orly'], ['암스테르담 스키폴', 'AMS', 'Amsterdam Schiphol 네덜란드'], ['프랑크푸르트', 'FRA', 'Frankfurt 독일'],
  ['뮌헨', 'MUC', 'Munich'], ['베를린', 'BER', 'Berlin'], ['로마 피우미치노', 'FCO', 'Rome Fiumicino 이탈리아'],
  ['밀라노 말펜사', 'MXP', 'Milan Malpensa'], ['베네치아', 'VCE', 'Venice'], ['바르셀로나', 'BCN', 'Barcelona 스페인'],
  ['마드리드', 'MAD', 'Madrid'], ['리스본', 'LIS', 'Lisbon 포르투갈'], ['취리히', 'ZRH', 'Zurich 스위스'],
  ['비엔나', 'VIE', 'Vienna 오스트리아'], ['프라하', 'PRG', 'Prague 체코'], ['부다페스트', 'BUD', 'Budapest 헝가리'],
  ['코펜하겐', 'CPH', 'Copenhagen 덴마크'], ['헬싱키', 'HEL', 'Helsinki 핀란드'], ['아테네', 'ATH', 'Athens 그리스'],
  // 북미·중남미
  ['뉴욕 JFK', 'JFK', 'New York 미국'], ['뉴어크', 'EWR', 'Newark New York'], ['로스앤젤레스', 'LAX', 'Los Angeles'],
  ['샌프란시스코', 'SFO', 'San Francisco'], ['시애틀', 'SEA', 'Seattle'], ['라스베이거스', 'LAS', 'Las Vegas'],
  ['시카고 오헤어', 'ORD', 'Chicago'], ['댈러스', 'DFW', 'Dallas'], ['애틀랜타', 'ATL', 'Atlanta'], ['마이애미', 'MIA', 'Miami'],
  ['호놀룰루', 'HNL', 'Honolulu Hawaii 하와이'], ['괌', 'GUM', 'Guam'], ['사이판', 'SPN', 'Saipan'],
  ['밴쿠버', 'YVR', 'Vancouver 캐나다'], ['토론토', 'YYZ', 'Toronto'], ['멕시코시티', 'MEX', 'Mexico City'], ['칸쿤', 'CUN', 'Cancun'],
  // 오세아니아
  ['시드니', 'SYD', 'Sydney 호주'], ['멜버른', 'MEL', 'Melbourne'], ['브리즈번', 'BNE', 'Brisbane'],
  ['오클랜드', 'AKL', 'Auckland 뉴질랜드'], ['퀸스타운', 'ZQN', 'Queenstown'],
];

export const AIRPORTS = A.map(([ko, code, extra]) => ({ value: `${ko} ${code}`, label: `${code} · ${extra}` }));
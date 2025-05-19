const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

//ініціалізація бази даних
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'ilyruban0610!',
  database: 'theater_db'
});

db.connect((err) => {
  if (err) {
    console.error('❌ Помилка підключення до бази даних: ', err);
  } else {
    console.log('✅ З\'єднано з MySQL');
  }
});

const app = express();
const port = 3000;
app.listen(port, () => {
  console.log(`Сервер слухає на порту ${port}`);
});

app.use(express.json());
app.use(cors());



app.use('/uploads', express.static('uploads'));

// Налаштування зберігання
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `user_${req.params.id}.${ext}`);
  }
});

const upload = multer({ storage });

const posterStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/poster';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `poster_${req.params.id}.${ext}`);
  }
});

const uploadPoster = multer({ storage: posterStorage });



// Головна сторінка
app.get('/', (req, res) => {
  res.send('Сервер працює 🚀');
});

//----------------------------------------------------------------------------------------//

//зміна зображення профіля
app.post('/api/user/:id/avatar', upload.single('avatar'), async (req, res) => {
  const user_id = req.params.id;
  const filename = req.file.filename;

  try {
    await db.promise().query(
      'UPDATE Users SET avatar_filename = ? WHERE user_id = ?',
      [filename, user_id]
    );

    res.json({
      message: 'Фото успішно оновлено',
      avatar_url: `http://192.168.1.103:3000/uploads/avatars/${filename}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при оновленні аватара' });
  }
});



// Отримати всіх користувачів
app.get('/api/users', async (req, res) => {
  try {
    const [users] = await db.promise().query('SELECT * FROM Users');
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні користувачів.' });
  }
});


//отримати всі вистави (якщо користувач хоче побачити більше - просто повертаємо усі вистави що є далі) 
//доробити вистави, які ще мають квитки
app.get('/api/plays', async (req, res) => {
  const { name, genre, city, minPrice, maxPrice, offset = 0 } = req.query;
  const limit = 15;

  let query = `
    SELECT p.play_id, p.name, p.genre, DATE_FORMAT(p.date, '%Y-%m-%d') AS date, p.start_time, p.end_time, p.poster_filename, MIN(sp.price) AS min_price, t.name AS theater_name, t.city,
    MIN(CASE WHEN s.type = 'parterre'    THEN sp.price END) AS parter_price,
    MIN(CASE WHEN s.type = 'balcony'   THEN sp.price END) AS balcony_price,
    MIN(CASE WHEN s.type = 'left box'  THEN sp.price END) AS left_price,
    MIN(CASE WHEN s.type = 'right box' THEN sp.price END) AS right_price
    FROM Plays AS p
    JOIN SeatsPlays AS sp ON sp.play_id = p.play_id
    JOIN Seats AS s ON s.seat_id = sp.seat_id
    JOIN Theaters AS t ON p.theater_id = t.theater_id`;

  let conditions = [];
  let params = [];

  if (name) {
    conditions.push('p.name LIKE ?');
    params.push(`%${name}%`);
  }
  if (genre) {
    conditions.push('p.genre = ?');
    params.push(genre);
  }
  if (city) {
    conditions.push('t.city = ?');
    params.push(city);
  }
  if (minPrice) {
    conditions.push('sp.price >= ?');
    params.push(minPrice);
  }
  if (maxPrice) {
    conditions.push('sp.price <= ?');
    params.push(maxPrice);
  }

  conditions.push(`
    EXISTS (
    SELECT 1 FROM SeatsPlays AS sp2
    WHERE sp2.play_id = p.play_id AND sp2.is_taken = false
    )`);


  query += ' WHERE ' + conditions.join(' AND ');

  query += `
    GROUP BY p.play_id
    ORDER BY p.date ASC
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));

  try {
    const [plays] = await db.promise().query(query, params);
    res.json(plays);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні вистав.' });
  }
});



// Реєстрація як користувач
app.post('/api/user/register', async (req, res) => {
  const { first_name, last_name, email, password } = req.body;

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: 'Всі поля є обовʼязковими.' });
  }

  try {
    const [existingUser] = await db.promise().query('SELECT * FROM Users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Користувач з такою електронною поштою вже існує.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.promise().query(
      'INSERT INTO Users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
      [first_name, last_name, email, hashedPassword]
    );

    res.status(201).json({ message: 'Користувач створений успішно.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера.' });
  }
});

// Вхід як користувач
app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Електронна пошта та пароль обовʼязкові.' });
  }

  try {
    const [users] = await db.promise().query('SELECT * FROM Users WHERE email = ?', [email]);
    const user = users[0];

    if (!user) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    res.status(200).json({ message: 'Вхід успішний.', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера.' });
  }
});

//інформація про користувача
app.get('/api/user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const [users] = await db.promise().query('SELECT * FROM Users WHERE user_id = ?', [userId]);
    if (!users.length) {
      return res.status(404).json({ error: 'Користувача не знайдено' });
    }
    res.json(users[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні користувача' });
  }
});

//користувач: зміна зображення профіля
app.post('/api/user/:id/avatar', upload.single('avatar'), async (req, res) => {
  const user_id = req.params.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Файл не надіслано.' });
  }

  const filename = req.file.filename;

  try {
    // Оновлення шляху до файлу в базі даних
    await db.promise().query(
      'UPDATE Users SET avatar_filename = ? WHERE user_id = ?',
      [filename, user_id]
    );

    res.status(200).json({
      message: 'Фото профілю успішно оновлено.',
      avatar_url: `http://localhost:3000/uploads/avatars/${filename}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при оновленні фото профілю.' });
  }
});


// Вхід як менеджер
app.post('/api/manager/login', async (req, res) => {
  const { email, password, access_code } = req.body;

  if (!email || !password || !access_code) {
    return res.status(400).json({ error: 'Електронна пошта, пароль і код доступу обовʼязкові.' });
  }

  try {
    const [users] = await db.promise().query('SELECT * FROM Users WHERE email = ?', [email]);
    const user = users[0];

    if (!user) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    const [managers] = await db.promise().query(
      'SELECT * FROM Managers WHERE user_id = ? AND access_code = ?',
      [user.user_id, access_code]
    );

    if (managers.length === 0) {
      return res.status(401).json({ error: 'Невірний код доступу для менеджера.' });
    }

    res.status(200).json({
      message: 'Вхід успішний як менеджер.',
      manager: {
        ...user,
        theater_id: managers[0].theater_id
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера.' });
  }
});

// Вхід як актор
app.post('/api/actor/login', async (req, res) => {
  const { email, password, access_code } = req.body;

  if (!email || !password || !access_code) {
    return res.status(400).json({ error: 'Електронна пошта, пароль і код доступу обовʼязкові.' });
  }

  try {
    const [users] = await db.promise().query('SELECT * FROM Users WHERE email = ?', [email]);
    const user = users[0];

    if (!user) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'Неправильна електронна пошта або пароль.' });
    }

    const [actors] = await db.promise().query(
      'SELECT * FROM Actors WHERE user_id = ? AND access_code = ?',
      [user.user_id, access_code]
    );

    if (actors.length === 0) {
      return res.status(401).json({ error: 'Невірний код доступу для актора.' });
    }

    res.status(200).json({
      message: 'Вхід успішний як актор.',
      actor: user
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера.' });
  }
});

//користувач: купівля квитка
app.post('/api/tickets/buy', async (req, res) => {
  const { user_id, play_id, seat_type, quantity } = req.body;

  if (!user_id || !play_id || !seat_type || !quantity) {
    return res.status(400).json({ error: 'Всі поля є обов’язковими.' });
  }

  try {
    //Перевірка: менеджери не можуть купувати
    const [managerCheck] = await db.promise().query(
      'SELECT * FROM Managers WHERE user_id = ?', [user_id]
    );
    if (managerCheck.length > 0) {
      return res.status(403).json({ error: 'Менеджери не можуть купувати квитки.' });
    }

    //Перевірка: вистава існує
    const [playRows] = await db.promise().query(
      'SELECT * FROM Plays WHERE play_id = ?', [play_id]
    );
    if (playRows.length === 0) {
      return res.status(404).json({ error: 'Виставу не знайдено.' });
    }
    const theater_id = playRows[0].theater_id;

    //Пошук вільних місць конкретного типу
    const [availableSeats] = await db.promise().query(
      `SELECT s.seat_id FROM Seats AS s
       JOIN SeatsPlays AS sp ON s.seat_id = sp.seat_id
       WHERE s.theater_id = ? AND s.type = ? AND sp.play_id = ? AND sp.is_taken = false
       LIMIT ?`,
      [theater_id, seat_type, play_id, quantity]
    );

    if (availableSeats.length < quantity) {
      return res.status(409).json({ error: 'Недостатньо вільних місць цієї категорії.' });
    }

    //Створення квитка
    const [ticketResult] = await db.promise().query(
      'INSERT INTO Tickets (is_valid, play_id, user_id) VALUES (true, ?, ?)',
      [play_id, user_id]
    );
    const ticket_id = ticketResult.insertId;

    //Привʼязка місць та оновлення їх статусу
    const seatIds = availableSeats.map(seat => seat.seat_id);

    for (const seat_id of seatIds) {
      await db.promise().query(
        'INSERT INTO TicketsSeats (ticket_id, seat_id) VALUES (?, ?)',
        [ticket_id, seat_id]
      );
      await db.promise().query(
        'UPDATE SeatsPlays SET is_taken = true WHERE seat_id = ? AND play_id = ?',
        [seat_id, play_id]
      );
    }

    //Отримати ціни і підрахувати суму
    const [seatPrices] = await db.promise().query(
      `SELECT price FROM SeatsPlays WHERE play_id = ? AND seat_id IN (${seatIds.map(() => '?').join(',')})`,
      [play_id, ...seatIds]
    );
    const totalPrice = seatPrices.reduce((sum, row) => sum + Number(row.price), 0);

    //Додати платіж
    await db.promise().query(
      `INSERT INTO Payments (ticket_id, payment_amount, payment_date, payment_time) VALUES (?, ?, CURDATE(), CURTIME())`,
      [ticket_id, totalPrice]
    );

    //Успішна відповідь
    res.status(201).json({
      message: 'Квиток успішно куплено.',
      ticket_id,
      seat_ids: seatIds,
      total_price: totalPrice
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при купівлі квитка.' });
  }
});

//користувач: усі платежі
app.get('/api/user/:id/payments', async (req, res) => {
  const { user_id } = req.params.id;

  if (!user_id) {
    return res.status(400).json({ error: 'Потрібен user_id у запиті.' });
  }

  try {
    const [payments] = await db.promise().query(`
      SELECT 
        p.payment_id, 
        p.payment_amount, 
        p.payment_date, 
        p.payment_time,
        pl.name AS play_name, 
        pl.date AS play_date, 
        pl.start_time, 
        pl.end_time, 
        th.name AS theater_name, 
        th.city,
        pl.poster_filename,
        CONCAT('http://10.0.30.100:3000/uploads/poster/', pl.poster_filename) AS poster_url,
        GROUP_CONCAT(s.seat_number ORDER BY s.seat_number SEPARATOR ',') AS seats
      FROM Payments AS p
      JOIN Tickets AS t ON p.ticket_id = t.ticket_id
      JOIN Plays AS pl ON pl.play_id = t.play_id
      JOIN Theaters AS th ON th.theater_id = pl.theater_id
      JOIN TicketsSeats AS ts  ON ts.ticket_id = t.ticket_id
      JOIN Seats AS s ON s.theater_id = th.theater_id
      WHERE t.user_id = ?
      GROUP BY payment_id
      ORDER BY p.payment_date DESC
    `, [user_id]);

    res.json(payments);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при отриманні платежів.' });
  }
});

//користувач: усі квитки
//змінити так само як усі платежі?
app.get('/api/user/:id/tickets', async (req, res) => {
  const user_id = req.params.id;

  if (!user_id) {
    return res.status(400).json({ error: 'Потрібен user_id у запиті.' });
  }

  try {
    //Отримати всі дійсні квитки з майбутніми виставами
    const [tickets] = await db.promise().query(`
      SELECT 
        t.ticket_id,
        p.play_id,
        p.name AS play_name,
        p.date AS play_date,
        p.start_time,
        p.end_time,
        th.name AS theater_name,
        th.city
      FROM Tickets AS t
      JOIN Plays AS p ON t.play_id = p.play_id
      JOIN Theaters AS th ON p.theater_id = th.theater_id
      WHERE t.user_id = ?
        AND t.is_valid = TRUE
        AND p.date >= CURDATE()
      ORDER BY p.date ASC, p.start_time ASC
    `, [user_id]);

    //Додати місця до кожного квитка
    for (let ticket of tickets) {
      const [seats] = await db.promise().query(`
        SELECT s.seat_number, s.type
        FROM TicketsSeats AS ts
        JOIN Seats AS s ON ts.seat_id = s.seat_id
        JOIN SeatsPlays AS sp ON sp.seat_id = s.seat_id
        WHERE ts.ticket_id = ?
        ORDER BY s.seat_number
      `, [ticket.ticket_id]);

      ticket.seats = seats;

    }

    res.json(tickets);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні активних квитків.' });
  }
});


//актор: побачити усі вистави, які будуть
app.get('/api/actor/:id/plays', async (req, res) => {
  const user_id = req.params.id;

  try {

    const [actorRows] = await db.promise().query(`
      SELECT 1 FROM ActorsPlays WHERE user_id = ? LIMIT 1
    `, [user_id]);

    let isAuthorized = actorRows.length > 0;

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Недостатньо прав для перегляду вистав.' });
    }


    const [plays] = await db.promise().query(`
      SELECT 
        p.play_id,
        p.name,
        p.genre,
        DATE_FORMAT(p.date, '%Y-%m-%d') AS date,
        p.start_time,
        p.end_time,
        th.name AS theater_name,
        th.city
      FROM ActorsPlays AS ap
      JOIN Plays AS p ON ap.play_id = p.play_id
      JOIN Theaters AS th ON p.theater_id = th.theater_id
      WHERE ap.user_id = ?
      AND p.date >= CURDATE()
      ORDER BY p.date ASC, p.start_time ASC
    `, [user_id]);

    res.json(plays);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні вистав актора.' });
  }

});

//актор та менеджер: переглянути усі репетиції до вистави
app.get('/api/rehearsals', async (req, res) => {
  const { play_id, user_id } = req.query;

  if (!play_id) {
    return res.status(400).json({ error: 'Потрібен play_id у запиті.' });
  }

  try {

      const [actorRows] = await db.promise().query(`
      SELECT 1 FROM ActorsPlays WHERE play_id = ? AND user_id = ?
    `, [play_id, user_id]);

    // Якщо не актор, перевірити чи менеджер цього театру
    let isAuthorized = actorRows.length > 0;

    if (!isAuthorized) {
      const [managerRows] = await db.promise().query(`
        SELECT 1 FROM Plays p
        JOIN Managers m ON p.theater_id = m.theater_id
        WHERE p.play_id = ? AND m.user_id = ?
      `, [play_id, user_id]);

      isAuthorized = managerRows.length > 0;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Недостатньо прав для перегляду репетицій.' });
    }

    const [rehearsals] = await db.promise().query(`
      SELECT
        rehearsal_id,
        name,
        date,
        start_time,
        end_time
      FROM Rehearsals
      WHERE play_id = ?
      ORDER BY date ASC, start_time ASC
    `, [play_id]);

    res.json(rehearsals);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні репетицій.' });
  }
});


//менеджер: побачити усі вистави свого театру, які будуть
app.get('/api/manager/plays', async (req, res) => {
  const user_id = req.query.user_id;
  const offset = parseInt(req.query.offset) || 0;
  const limit = 15;

  if (!user_id) {
    return res.status(400).json({ error: 'Потрібен user_id у запиті.' });
  }

  try {
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );

    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не привʼязаний до театру.' });
    }

    const [plays] = await db.promise().query(`SELECT p.* FROM Plays AS p JOIN Managers AS m ON p.theater_id = m.theater_id WHERE m.user_id = ? ORDER BY p.date ASC, p.start_time ASC LIMIT ? OFFSET ?`, [user_id, limit, offset]);
    res.json(plays);
  }
  catch(err){
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні вистав театру.' });
  }

  
});


//менеджер: побачити усіх акторів однієї вистави
app.get('/api/manager/plays/actors', async (req, res) => {
  const { play_id } = req.query;

  if (!play_id) {
    return res.status(400).json({ error: 'Потрібен play_id у запиті.' });
  }

  try{
    const [actors] = await db.promise().query(`SELECT u.user_id, u.first_name, u.last_name FROM Users AS u
     JOIN ActorsPlays AS ap ON ap.user_id = u.user_id WHERE ap.play_id = ?
      `, [play_id]);
    
    res.json(actors);
  }
  catch(err){
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні акторів вистави.' });
  }

});


//менеджер: побачити усіх акторів свого театру
app.get('/api/manager/actors', async (req, res) => {
  const {user_id} = req.query;

  if (!user_id){
    return res.status(400).json({ error: 'Потрібен user_id у запиті.' });
  }

  try{

    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );

    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не привʼязаний до театру.' });
    }

    const [actors] = await db.promise().query(
      `SELECT DISTINCT a.user_id, u.first_name, u.last_name
      FROM Actors AS a
      JOIN Users AS u ON u.user_id = a.user_id
      JOIN ActorsTheaters AS at ON a.user_id = at.user_id
      JOIN Managers AS m ON m.theater_id = at.theater_id
      WHERE m.user_id = ? 
      `, [user_id]);
    
    res.json(actors);
  }
  catch(err){
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні акторів театру.' });
  }
});


//менеджер: додати виставу
app.post('/api/manager/plays/create', async (req, res) => {
  const {
    name,
    genre,
    date,
    start_time,
    end_time,
    user_id,      // ID менеджера
    prices,
    actor_ids
  } = req.body;

  if (!name || !genre || !date || !start_time || !end_time || !user_id || !prices || !actor_ids) {
    return res.status(400).json({ error: 'Усі поля (включно з actor_ids) обовʼязкові.' });
  }

  try {
    // Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не привʼязаний до театру.' });
    }
    const theater_id = managerRows[0].theater_id;

    // Отримати імʼя менеджера
    const [userRows] = await db.promise().query(
      'SELECT first_name, last_name FROM Users WHERE user_id = ?',
      [user_id]
    );
    const managerName = `${userRows[0].first_name} ${userRows[0].last_name}`;

    // Додати виставу
    const [insertResult] = await db.promise().query(`
      INSERT INTO Plays (name, genre, date, start_time, end_time, theater_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, genre, date, start_time, end_time, theater_id]);
    const play_id = insertResult.insertId;

    // Додати ціни для місць
    const seatTypes = Object.keys(prices);
    for (const type of seatTypes) {
      const price = prices[type];
      const [seats] = await db.promise().query(`
        SELECT seat_id FROM Seats WHERE theater_id = ? AND type = ?
      `, [theater_id, type]);

      for (const seat of seats) {
        await db.promise().query(`
          INSERT INTO SeatsPlays (seat_id, play_id, price, is_taken)
          VALUES (?, ?, ?, false)
        `, [seat.seat_id, play_id, price]);
      }
    }

    // Додати акторів до вистави і створити сповіщення
    for (const actor_id of actor_ids) {
      const [exists] = await db.promise().query(`
        SELECT 1 FROM ActorsTheaters
        WHERE user_id = ? AND theater_id = ?
      `, [actor_id, theater_id]);

      if (exists.length === 0) {
        return res.status(400).json({ error: `Актор ${actor_id} не належить до цього театру.` });
      }

      await db.promise().query(`
        INSERT INTO ActorsPlays (user_id, play_id) VALUES (?, ?)
      `, [actor_id, play_id]);

      const message = `${managerName} додав/-ла вас до вистави "${name}"`;

      await db.promise().query(`
        INSERT INTO Notifications (actor_id, manager_id, play_id, message, create_time, create_date)
        VALUES (?, ?, ?, ?, CURTIME(), CURDATE())
      `, [actor_id, user_id, play_id, message]);
    }

    res.status(201).json({
      message: 'Вистава створена успішно.',
      play_id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при створенні вистави.' });
  }
});


//менеджер: пошук акторів театру за ім'ям
app.get('/api/manager/actors/search', async (req, res) => {
  const {user_id, name} = req.query;

  if (!user_id || !name) {
    return res.status(400).json({ error: 'Потрібні user_id та name у запиті.' });
  }

  const [managerRows] = await db.promise().query(
      `SELECT theater_id FROM Managers WHERE user_id = ?`, [user_id]);

  if (!managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
  }

  try{
    const [actors] = await db.promise().query(`
      SELECT u.user_id, u.first_name, u.last_name
      FROM Users AS u
      JOIN Actors AS a ON u.user_id = a.user_id
      JOIN ActorsTheaters AS at ON at.user_id = a.user_id
      JOIN Managers AS m ON m.theater_id = at.theater_id
      WHERE m.user_id = ?
      AND (u.first_name LIKE ? OR u.last_name LIKE ?)  
      `, [user_id, `%${name}%`, `%${name}%`]);

      res.json(actors);
  }
  catch(err){
    console.error(err);
    res.status(500).json({ error: 'Помилка при пошуку актора.' });
  }
});

//менеджер: створити акаунт актора - при цьому він одразу буде визначений, як актор цього театру
app.post('/api/manager/actors/create', async (req, res) => {
  const { manager_id, first_name, last_name, email, password, access_code } = req.body;

  if (!manager_id || !first_name || !last_name || !email || !password || !access_code) {
    return res.status(400).json({ error: 'Всі поля обовʼязкові.' });
  }

  try {
    //Перевірити, що користувач є менеджером
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [manager_id]
    );

    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    //Перевірка, що email унікальний
    const [existingUsers] = await db.promise().query(
      'SELECT * FROM Users WHERE email = ?',
      [email]
    );
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Користувач з такою поштою вже існує.' });
    }

    //Захешувати пароль
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    //Створити користувача
    const [userResult] = await db.promise().query(
      'INSERT INTO Users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
      [first_name, last_name, email, hashedPassword]
    );
    const actor_user_id = userResult.insertId;

    //Додати до Actors
    await db.promise().query(
      'INSERT INTO Actors (user_id, access_code) VALUES (?, ?)',
      [actor_user_id, access_code]
    );

    //Додати до ActorsTheaters
    await db.promise().query(
      'INSERT INTO ActorsTheaters (user_id, theater_id) VALUES (?, ?)',
      [actor_user_id, theater_id]
    );

    //Отримати імʼя менеджера
    const [managerUserRows] = await db.promise().query(
      'SELECT first_name, last_name FROM Users WHERE user_id = ?',
      [manager_id]
    );
    const managerName = `${managerUserRows[0].first_name} ${managerUserRows[0].last_name}`;

    //Додати сповіщення
    const message = `${managerName} створив/-ла вам акаунт`;

    await db.promise().query(
      'INSERT INTO Notifications (actor_id, manager_id, message, create_time, create_date) VALUES (?, ?, ?, CURTIME(), CURDATE())',
      [actor_user_id, manager_id, message]
    );

    res.status(201).json({
      message: 'Актор створений, доданий до театру та сповіщення надіслано.',
      actor_user_id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при створенні актора.' });
  }
});


//менеджер: додати актора до театру
app.post('/api/manager/:id/hire', async (req, res) => {
  const { user_id, actor_id } = req.body;

  if (!user_id || !actor_id) {
    return res.status(400).json({ error: 'Потрібні user_id та actor_id у запиті.' });
  }

  try {
    //Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      `SELECT theater_id FROM Managers WHERE user_id = ?`, [user_id]);

    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    //Перевірити, чи актор вже працює у цьому театрі
    const [actorTheaterRows] = await db.promise().query(
      'SELECT * FROM ActorsTheaters WHERE user_id = ? AND theater_id = ?',
      [actor_id, theater_id]
    );

    if (actorTheaterRows.length !== 0) {
      return res.status(409).json({ error: 'Актор уже належить до цього театру.' });
    }

    //Додати актора до театру
    await db.promise().query(
      'INSERT INTO ActorsTheaters (user_id, theater_id) VALUES (?, ?)',
      [actor_id, theater_id]
    );

    //Отримати імʼя менеджера
    const [managerNameRows] = await db.promise().query(
      'SELECT first_name, last_name FROM Users WHERE user_id = ?',
      [user_id]
    );
    const managerName = `${managerNameRows[0].first_name} ${managerNameRows[0].last_name}`;

    // 5. Отримати назву театру та місто
    const [theaterRows] = await db.promise().query(
      'SELECT name, city FROM Theaters WHERE theater_id = ?',
      [theater_id]
    );
    const { name: theaterName, city } = theaterRows[0];

    // 6. Створити сповіщення
    const message = `${managerName} найняв/-ла вас до ${theaterName}, ${city}`;

    await db.promise().query(`
      INSERT INTO Notifications (actor_id, manager_id, message, create_time, create_date)
      VALUES (?, ?, ?, CURTIME(), CURDATE())
    `, [actor_id, user_id, message]);

    res.json({ message: 'Актор успішно доданий до театру та повідомлений.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при наймі актора.' });
  }
});

app.post('/api/manager/:id/fire', async (req, res) => {
  const { user_id } = req.body;
  const actor_id = req.params.id;

  if (!user_id || !actor_id) {
    return res.status(400).json({ error: 'Потрібні user_id та actor_id у запиті.' });
  }

  try {
    //Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      `SELECT theater_id FROM Managers WHERE user_id = ?`, [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    //Перевірити, чи актор дійсно належить до цього театру
    const [actorTheaterRows] = await db.promise().query(
      'SELECT * FROM ActorsTheaters WHERE user_id = ? AND theater_id = ?',
      [actor_id, theater_id]
    );
    if (actorTheaterRows.length === 0) {
      return res.status(404).json({ error: 'Актор не належить до цього театру.' });
    }

    //Отримати імʼя менеджера
    const [managerUserRows] = await db.promise().query(
      'SELECT first_name, last_name FROM Users WHERE user_id = ?',
      [user_id]
    );
    const managerName = `${managerUserRows[0].first_name} ${managerUserRows[0].last_name}`;

    //Отримати імʼя театру і місто
    const [theaterRows] = await db.promise().query(
      'SELECT name, city FROM Theaters WHERE theater_id = ?',
      [theater_id]
    );
    const { name: theaterName, city } = theaterRows[0];

    // 5. Видалити актора з театру
    await db.promise().query(
      'DELETE FROM ActorsTheaters WHERE user_id = ? AND theater_id = ?',
      [actor_id, theater_id]
    );

    //Створити сповіщення
    const message = `${managerName} звільнив/-ла вас з театру ${theaterName}, ${city}`;

    await db.promise().query(
      'INSERT INTO Notifications (actor_id, manager_id, message, create_time, create_date) VALUES (?, ?, ?, CURTIME(), CURDATE())',
      [actor_id, user_id, message]
    );

    res.json({ message: 'Актор успішно звільнений з театру та повідомлений.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при звільненні актора.' });
  }
});


//менеджер: редагувати виставу
app.put('/api/manager/plays/:play_id', async (req, res) => {
  const play_id = req.params.play_id;
  const {
    user_id, // менеджер
    name,
    genre,
    date,
    start_time,
    end_time,
    prices // необов’язково
  } = req.body;

  if (!user_id || !play_id) {
    return res.status(400).json({ error: 'Потрібні user_id і play_id.' });
  }

  try {
    //Театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?', [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }
    const theater_id = managerRows[0].theater_id;

    //Вистава
    const [playRows] = await db.promise().query(
      'SELECT * FROM Plays WHERE play_id = ? AND theater_id = ?', [play_id, theater_id]
    );
    if (playRows.length === 0) {
      return res.status(403).json({ error: 'Виставу не знайдено або вона не належить вашому театру.' });
    }
    const currentPlay = playRows[0];

    //Підготувати нові значення
    const updatedFields = {
      name: name ?? currentPlay.name,
      genre: genre ?? currentPlay.genre,
      date: date ?? currentPlay.date,
      start_time: start_time ?? currentPlay.start_time,
      end_time: end_time ?? currentPlay.end_time
    };

    //Оновити виставу
    await db.promise().query(`
      UPDATE Plays SET name = ?, genre = ?, date = ?, start_time = ?, end_time = ?
      WHERE play_id = ?
    `, [
      updatedFields.name,
      updatedFields.genre,
      updatedFields.date,
      updatedFields.start_time,
      updatedFields.end_time,
      play_id
    ]);

    //Оновити ціни
    if (prices && typeof prices === 'object') {
      for (const type in prices) {
        const price = prices[type];

        const [seats] = await db.promise().query(
          'SELECT seat_id FROM Seats WHERE theater_id = ? AND type = ?', [theater_id, type]
        );

        for (const seat of seats) {
          await db.promise().query(
            'UPDATE SeatsPlays SET price = ? WHERE play_id = ? AND seat_id = ?',
            [price, play_id, seat.seat_id]
          );
        }
      }
    }

    //Порівняти зміни
    const changes = [];
    if (name && name !== currentPlay.name) {
      changes.push(`назву на "${name}"`);
    }
    if (date && date !== currentPlay.date.toISOString().split('T')[0]) {
      changes.push(`дату на ${date}`);
    }
    if (start_time && start_time !== currentPlay.start_time) {
      changes.push(`час початку на ${start_time}`);
    }
    if (end_time && end_time !== currentPlay.end_time) {
      changes.push(`час завершення на ${end_time}`);
    }

    //Якщо були зміни, сповістити акторів
    if (changes.length > 0) {
      const [actorIds] = await db.promise().query(
        'SELECT user_id FROM ActorsPlays WHERE play_id = ?', [play_id]
      );

      const [managerInfo] = await db.promise().query(
        'SELECT first_name, last_name FROM Users WHERE user_id = ?', [user_id]
      );
      const managerName = `${managerInfo[0].first_name} ${managerInfo[0].last_name}`;

      const messageBase = `${managerName} змінив/-ла інформацію про виставу "${currentPlay.name}"`;

      const fullMessage = changes.map(change => `${messageBase}, змінивши ${change}.`);

      for (const actor of actorIds) {
        for (const msg of fullMessage) {
          await db.promise().query(`
            INSERT INTO Notifications (actor_id, manager_id, play_id, message, create_time, create_date)
            VALUES (?, ?, ?, ?, CURTIME(), CURDATE())
          `, [actor.user_id, user_id, play_id, msg]);
        }
      }
    }

    res.json({ message: 'Виставу успішно оновлено.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при оновленні вистави.' });
  }
});


//менеджер: скасувати виставу
app.delete('/api/manager/plays/:play_id', async (req, res) => {
  const play_id = req.params.play_id;
  const { user_id } = req.body; // ID менеджера

  if (!user_id || !play_id) {
    return res.status(400).json({ error: 'Потрібні user_id та play_id.' });
  }

  try {
    //Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }
    const theater_id = managerRows[0].theater_id;

    //Перевірити, чи вистава належить театру менеджера
    const [playRows] = await db.promise().query(
      'SELECT * FROM Plays WHERE play_id = ? AND theater_id = ?',
      [play_id, theater_id]
    );
    if (playRows.length === 0) {
      return res.status(403).json({ error: 'Виставу не знайдено або вона не належить вашому театру.' });
    }

    const play = playRows[0];

    //Отримати імʼя менеджера
    const [managerInfo] = await db.promise().query(
      'SELECT first_name, last_name FROM Users WHERE user_id = ?',
      [user_id]
    );
    const managerName = `${managerInfo[0].first_name} ${managerInfo[0].last_name}`;

    //Отримати всіх акторів цієї вистави
    const [actors] = await db.promise().query(
      'SELECT user_id FROM ActorsPlays WHERE play_id = ?',
      [play_id]
    );

    const now = new Date();
    const create_date = now.toISOString().split('T')[0];
    const create_time = now.toTimeString().split(' ')[0];

    const message = `${managerName} скасував виставу "${play.name}"`;
    //Додати сповіщення для кожного актора
    for (const actor of actors) {
      await db.promise().query(
        `INSERT INTO Notifications (actor_id, manager_id, play_id, message, create_time, create_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [actor.user_id, user_id, play_id, message, create_time, create_date]
      );
    }

    //Видалити виставу (каскадно видаляться пов’язані квитки, репетиції, тощо)
    await db.promise().query(
      'DELETE FROM Plays WHERE play_id = ?',
      [play_id]
    );

    res.json({ message: 'Виставу успішно скасовано.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при скасуванні вистави.' });
  }
});


//менеджер: зміна афіші вистави
app.post('/api/manager/plays/:play_id/poster', uploadPoster.single('poster'), async (req, res) => {
  const { play_id } = req.params;
  const { user_id } = req.body;
  const filename = req.file.filename;

  if (!user_id) {
    return res.status(400).json({ error: 'Потрібен user_id.' });
  }

  try {
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (!managerRows.length) {
      return res.status(403).json({ error: 'Менеджера не знайдено або немає театру.' });
    }

    const [playRows] = await db.promise().query(
      'SELECT * FROM Plays WHERE play_id = ? AND theater_id = ?',
      [play_id, managerRows[0].theater_id]
    );
    if (!playRows.length) {
      return res.status(403).json({ error: 'Виставу не знайдено або вона не належить театру.' });
    }

    await db.promise().query(
      'UPDATE Plays SET poster_filename = ? WHERE play_id = ?',
      [filename, play_id]
    );

    res.json({
      message: 'Афішу оновлено успішно.',
      poster_url: `http://localhost:3000/uploads/posters/${filename}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при оновленні афіші.' });
  }
});

//менеджер: додати репетицію до вистави
app.post('/api/manager/rehearsals', async (req, res) => {
  const {
    user_id,       // ID менеджера
    play_id,       // ID вистави
    name,          // Назва репетиції
    date,          // Дата (формат YYYY-MM-DD)
    start_time,    // Початок (формат HH:MM:SS)
    end_time       // Кінець (формат HH:MM:SS)
  } = req.body;

  // Перевірка обов’язкових полів
  if (!user_id || !play_id || !name || !date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Усі поля є обов’язковими.' });
  }

  try {
    // Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    // Перевірити, чи вистава належить цьому театру
    const [playRows] = await db.promise().query(
      'SELECT * FROM Plays WHERE play_id = ? AND theater_id = ?',
      [play_id, theater_id]
    );
    if (playRows.length === 0) {
      return res.status(403).json({ error: 'Виставу не знайдено або вона не належить театру менеджера.' });
    }

    // Додати репетицію
    await db.promise().query(
      'INSERT INTO Rehearsals (name, date, start_time, end_time, play_id) VALUES (?, ?, ?, ?, ?)',
      [name, date, start_time, end_time, play_id]
    );

    res.status(201).json({ message: 'Репетицію успішно додано.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при додаванні репетиції.' });
  }
});


//менеджер: редагувати репетицію
app.put('/api/manager/rehearsals/:rehearsal_id', async (req, res) => {
  const rehearsal_id = req.params.rehearsal_id;
  const { user_id, name, date, start_time, end_time } = req.body;

  if (!user_id || !rehearsal_id) {
    return res.status(400).json({ error: 'Потрібні user_id та rehearsal_id.' });
  }

  try {
    //Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    //Перевірити, чи репетиція належить виставі з цього театру
    const [rehearsalRows] = await db.promise().query(
      `SELECT r.*, p.theater_id FROM Rehearsals AS r
       JOIN Plays AS p ON r.play_id = p.play_id
       WHERE r.rehearsal_id = ? AND p.theater_id = ?`,
      [rehearsal_id, theater_id]
    );

    if (rehearsalRows.length === 0) {
      return res.status(404).json({ error: 'Репетицію не знайдено або вона не належить театру менеджера.' });
    }

    const current = rehearsalRows[0];

    //Оновити поля, якщо задані
    const updated = {
      name: name ?? current.name,
      date: date ?? current.date,
      start_time: start_time ?? current.start_time,
      end_time: end_time ?? current.end_time
    };

    await db.promise().query(
      `UPDATE Rehearsals SET name = ?, date = ?, start_time = ?, end_time = ? WHERE rehearsal_id = ?`,
      [updated.name, updated.date, updated.start_time, updated.end_time, rehearsal_id]
    );

    res.json({ message: 'Репетицію успішно оновлено.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при оновленні репетиції.' });
  }
});


//менеджер: скасувати репетицію
app.delete('/api/manager/rehearsals/:rehearsal_id', async (req, res) => {
  const { rehearsal_id } = req.params;
  const { user_id } = req.body; // ID менеджера

  if (!user_id || !rehearsal_id) {
    return res.status(400).json({ error: 'Потрібні user_id та rehearsal_id.' });
  }

  try {
    // Отримати театр менеджера
    const [managerRows] = await db.promise().query(
      'SELECT theater_id FROM Managers WHERE user_id = ?',
      [user_id]
    );
    if (managerRows.length === 0) {
      return res.status(403).json({ error: 'Менеджера не знайдено або він не має театру.' });
    }

    const theater_id = managerRows[0].theater_id;

    // Перевірити, чи ця репетиція належить виставі з цього театру
    const [rehearsalRows] = await db.promise().query(
      `SELECT r.rehearsal_id 
       FROM Rehearsals r
       JOIN Plays p ON r.play_id = p.play_id
       WHERE r.rehearsal_id = ? AND p.theater_id = ?`,
      [rehearsal_id, theater_id]
    );

    if (rehearsalRows.length === 0) {
      return res.status(403).json({ error: 'Репетицію не знайдено або вона не належить вашому театру.' });
    }

    // Видалення репетиції
    await db.promise().query(
      'DELETE FROM Rehearsals WHERE rehearsal_id = ?',
      [rehearsal_id]
    );

    res.json({ message: 'Репетицію успішно скасовано.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при скасуванні репетиції.' });
  }
});




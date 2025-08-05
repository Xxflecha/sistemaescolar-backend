import express from 'express';
import pg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

dotenv.config();

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Pool adaptado para Railway (usa SSL)
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false }
});

// Middleware para servir imágenes
app.use('/imagenes', express.static(path.join(process.cwd(), 'imagenes')));

// Configuración de multer para guardar imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(process.cwd(), 'imagenes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `alumno_${req.params.id}${ext}`);
  }
});
const upload = multer({ storage });

// Endpoint de login para jefe de departamento
app.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (role !== 'jefe') {
    return res.status(403).json({ success: false, message: 'Rol no autorizado' });
  }
  try {
    const query = 'SELECT id, usuario, contrasena, nombre, apellido, departamento_id FROM jefes_departamento WHERE usuario = $1';
    const values = [username];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const jefe = result.rows[0];
    const match = (password === jefe.contrasena);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const { contrasena, ...jefeSinContrasena } = jefe;
    res.json({ success: true, jefe: jefeSinContrasena });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error en el servidor', error: err.message });
  }
});

// Endpoint para obtener todos los docentes
app.get('/api/docentes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM docentes ORDER BY nombre, apellido');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener docentes', details: err.message });
  }
});

// Endpoint para obtener un docente por id
app.get('/api/docentes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM docentes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Docente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener docente', details: err.message });
  }
});

// Endpoint para actualizar un docente por id
app.put('/api/docentes/:id', async (req, res) => {
  try {
    let { id } = req.params;
    id = Number(id); // Asegura que sea número
    if (!id || isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const campos = [
      'clave','nombre','apellido','calle','colonia','cp','correo_personal','fecha_nacimiento','numero','ciudad','telefono','correo_institucional','antiguedad'
    ];
    const updates = [];
    const values = [];
    campos.forEach((campo) => {
      let valor = req.body[campo];
      if (valor !== undefined) {
        // Normaliza fecha_nacimiento a YYYY-MM-DD si es string
        if (campo === 'fecha_nacimiento' && typeof valor === 'string') {
          // Si viene como ISO, recorta solo la fecha
          if (valor.includes('T')) valor = valor.split('T')[0];
          // Si es vacío, mándalo como null
          if (valor.trim() === '') valor = null;
        }
        // Si es string vacío, mándalo como null
        if (typeof valor === 'string' && valor.trim() === '') valor = null;
        // Si el campo es id y es string numérico, conviértelo a número
        if (campo === 'id' && typeof valor === 'string' && !isNaN(valor)) valor = Number(valor);
        updates.push(`${campo} = $${values.length + 1}`);
        values.push(valor);
      }
    });

    // LOG: Muestra los datos recibidos y el query generado
    console.log('PUT /api/docentes/:id', { id, body: req.body, updates, values });

    if (updates.length === 0) return res.status(400).json({ error: 'Sin datos para actualizar' });
    values.push(id);
    const updateResult = await pool.query(
      `UPDATE docentes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (updateResult.rows.length === 0) {
      console.log('No se encontró el docente para actualizar:', id);
      return res.status(404).json({ error: 'Docente no encontrado' });
    }
    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error('Error en PUT /api/docentes/:id:', err);
    res.status(500).json({ error: 'Error al guardar cambios', details: err.message });
  }
});

// LOGIN ALUMNO
app.post('/login-alumno', async (req, res) => {
  // Acepta tanto { usuario, contrasena } como { username, password }
  const usuario = req.body.usuario || req.body.username;
  const contrasena = req.body.contrasena || req.body.password;
  if (!usuario || !contrasena) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }
  try {
    // Cambia este SELECT para incluir el nombre del periodo actual
    const result = await pool.query(
      `SELECT a.*, p.nombre AS periodo_actual
       FROM alumnos a
       LEFT JOIN periodos p ON a.periodo_actual_id = p.id
       WHERE a.usuario = $1`,
      [usuario]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const alumno = result.rows[0];
    const match = (contrasena === alumno.contrasena);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const { contrasena: _, ...alumnoSinContrasena } = alumno;
    res.json({ success: true, alumno: alumnoSinContrasena });
  } catch (err) {
    // Log detallado para depuración
    console.error('Error en /login-alumno:', err);
    res.status(500).json({ success: false, message: 'Error en el servidor', error: err.message });
  }
});

// LOGIN DOCENTE
app.post('/login-docente', async (req, res) => {
  // Cambia a username y password para que coincida con el frontend
  const usuario = req.body.username || req.body.usuario;
  const contrasena = req.body.password || req.body.contrasena;
  if (!usuario || !contrasena) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM docentes WHERE clave = $1 OR usuario = $1`,
      [usuario]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const docente = result.rows[0];
    const match = docente.contrasena ? (contrasena === docente.contrasena) : true;
    if (!match) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
    const { contrasena: _, ...docenteSinContrasena } = docente;
    res.json({ success: true, docente: docenteSinContrasena });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error en el servidor', error: err.message });
  }
});

// Endpoint para subir foto de perfil de alumno
app.post('/api/alumnos/:id/foto', upload.single('foto'), async (req, res) => {
  const id = req.params.id;
  if (!req.file) return res.status(400).json({ success: false, message: 'No se subió archivo' });
  const fotoUrl = `/imagenes/${req.file.filename}`;
  try {
    await pool.query('UPDATE alumnos SET foto_perfil = $1 WHERE id = $2', [fotoUrl, id]);
    res.json({ success: true, fotoUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al guardar foto', error: err.message });
  }
});

// Obtén el periodo actual por nombre desde la tabla periodo_actual
async function getPeriodoActualNombre() {
  const periodoRes = await pool.query('SELECT nombre FROM periodo_actual LIMIT 1');
  return periodoRes.rows[0]?.nombre || '';
}

// Endpoint para obtener el horario del periodo actual de un alumno (incluye docente)
app.get('/api/horario/:alumno_id', async (req, res) => {
  const alumno_id = parseInt(req.params.alumno_id, 10);
  if (!alumno_id) return res.json([]);
  try {
    const periodoActual = await getPeriodoActualNombre();
    const result = await pool.query(`
      SELECT 
        h.id AS horario_id,
        h.grupo,
        h.lunes, h.martes, h.miercoles, h.jueves, h.viernes, h.sabado, h.domingo,
        m.id AS materia_id,
        m.clave AS clave_materia,
        m.nombre AS nombre_materia,
        m.creditos,
        d.nombre || ' ' || d.apellido AS docente_nombre
      FROM horario h
      JOIN materias m ON h.materia_id = m.id
      LEFT JOIN docentes d ON h.docente_id = d.id
      WHERE h.alumno_id = $1 AND h.periodo = $2
      ORDER BY m.clave ASC
    `, [alumno_id, periodoActual]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener horario', details: err.message });
  }
});

// Endpoint mejorado: horarios de docentes por periodo actual (sin columna alumnos)
app.get('/api/horarios-docentes-jefe', async (req, res) => {
  try {
    const periodo = req.query.periodo || await getPeriodoActualNombre();
    const result = await pool.query(`
      SELECT 
        h.id,
        d.id AS docente_id,
        d.nombre || ' ' || d.apellido AS docente_nombre,
        m.clave AS clave_materia,
        m.nombre AS materia_nombre,
        h.grupo,
        h.periodo, -- <--- Asegura que este campo se incluya
        h.lunes, h.martes, h.miercoles, h.jueves, h.viernes, h.sabado, h.domingo
      FROM horario h
      LEFT JOIN docentes d ON h.docente_id = d.id
      JOIN materias m ON h.materia_id = m.id
      WHERE h.periodo = $1 AND h.docente_id IS NOT NULL
      ORDER BY d.nombre, h.grupo, m.clave
    `, [periodo]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener horarios de docentes', details: err.message });
  }
});

// Endpoint para obtener todos los horarios del periodo actual (para jefe de departamento)
app.get('/api/horarios-jefe', async (req, res) => {
  try {
    const periodo = req.query.periodo || await getPeriodoActualNombre();
    const result = await pool.query(`
      SELECT 
        h.id AS horario_id,
        h.grupo,
        h.lunes, h.martes, h.miercoles, h.jueves, h.viernes, h.sabado, h.domingo,
        m.clave AS clave_materia,
        m.nombre AS nombre_materia,
        m.creditos,
        d.nombre || ' ' || d.apellido AS docente_nombre,
        a.no_control,
        a.nombre AS alumno_nombre,
        a.apellido_paterno,
        a.apellido_materno,
        h.periodo -- <--- Asegura que este campo se incluya
      FROM horario h
      JOIN materias m ON h.materia_id = m.id
      LEFT JOIN docentes d ON h.docente_id = d.id
      LEFT JOIN alumnos a ON h.alumno_id = a.id
      WHERE h.periodo = $1
      ORDER BY h.grupo, m.clave, a.no_control
    `, [periodo]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener horarios para jefe', details: err.message });
  }
});

// Endpoint: información completa de alumno para edición por jefe de departamento
app.get('/api/alumno-completo/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Info personal y académica
    const alumnoRes = await pool.query('SELECT * FROM alumnos WHERE id = $1', [id]);
    if (alumnoRes.rows.length === 0) return res.status(404).json({ error: 'Alumno no encontrado' });
    const alumno = alumnoRes.rows[0];

    // Horario actual
    const periodoActual = await getPeriodoActualNombre();
    const horarioRes = await pool.query(`
      SELECT h.*, m.clave AS clave_materia, m.nombre AS nombre_materia, m.creditos
      FROM horario h
      JOIN materias m ON h.materia_id = m.id
      WHERE h.alumno_id = $1 AND h.periodo = $2
      ORDER BY m.clave ASC
    `, [id, periodoActual]);
    alumno.horario = horarioRes.rows;

    // Calificaciones actuales
    const califRes = await pool.query(`
      SELECT c.*, m.clave AS clave_materia, m.nombre AS nombre_materia, m.creditos
      FROM calificaciones c
      JOIN materias m ON c.materia_id = m.id
      WHERE c.alumno_id = $1 AND c.periodo = $2
      ORDER BY m.clave ASC
    `, [id, periodoActual]);
    alumno.calificaciones = califRes.rows;

    res.json(alumno);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener datos completos del alumno', details: err.message });
  }
});

// Endpoint para editar horario (PUT)
app.put('/api/horario/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { grupo, docente_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo } = req.body;
  if (!id) return res.json({ success: false, message: 'ID inválido' });
  try {
    await pool.query(
      `UPDATE horario SET grupo=$1, docente_id=$2, lunes=$3, martes=$4, miercoles=$5, jueves=$6, viernes=$7, sabado=$8, domingo=$9 WHERE id=$10`,
      [grupo, docente_id, lunes, martes, miercoles, jueves, viernes, sabado, domingo, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Endpoint para obtener el periodo actual general
app.get('/api/periodo-actual', async (req, res) => {
  try {
    const result = await pool.query('SELECT nombre FROM periodo_actual LIMIT 1');
    res.json({ periodo_actual: result.rows[0]?.nombre || '' });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener periodo actual', details: err.message });
  }
});

// Endpoint para cambiar el periodo actual (solo jefe de departamento)
app.put('/api/periodo-actual', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.json({ success: false, message: 'Nombre de periodo requerido' });
  try {
    await pool.query('DELETE FROM periodo_actual');
    await pool.query('INSERT INTO periodo_actual (nombre) VALUES ($1)', [nombre]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Endpoint para editar datos de alumno (por jefe de departamento)
app.put('/api/alumnos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'ID inválido' });
  // Lista de campos editables
  const campos = [
    'no_control', 'nombre', 'apellido_paterno', 'apellido_materno', 'curp', 'fecha_nacimiento', 'correo_personal',
    'telefono', 'carrera', 'especialidad', 'modalidad', 'plan_estudios', 'semestre', 'estatus', 'fecha_ingreso',
    'creditos_plan', 'creditos_aprobados', 'materias_totales', 'materias_aprobadas', 'promedio_general', 'foto_perfil'
  ];
  const updates = [];
  const values = [];
  campos.forEach((campo) => {
    let valor = req.body[campo];
    if (valor !== undefined) {
      // Normaliza fecha_nacimiento a YYYY-MM-DD si es string
      if (campo === 'fecha_nacimiento' && typeof valor === 'string') {
        if (valor.includes('T')) valor = valor.split('T')[0];
        if (valor.trim() === '') valor = null;
      }
      if (typeof valor === 'string' && valor.trim() === '') valor = null;
      updates.push(`${campo} = $${values.length + 1}`);
      values.push(valor);
    }
  });
  if (updates.length === 0) return res.status(400).json({ success: false, message: 'Sin datos para actualizar' });
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE alumnos SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Alumno no encontrado' });
    res.json({ success: true, alumno: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al guardar cambios', error: err.message });
  }
});

// Endpoint para obtener todos los alumnos
app.get('/api/alumnos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM alumnos ORDER BY nombre, apellido_paterno, apellido_materno');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener alumnos', details: err.message });
  }
});

// Endpoint para obtener el horario del docente en el periodo actual
app.get('/api/horario-docente/:docente_id', async (req, res) => {
  const docente_id = parseInt(req.params.docente_id, 10);
  if (!docente_id) return res.json([]);
  try {
    const periodoActual = await getPeriodoActualNombre();
    const result = await pool.query(`
      SELECT 
        h.id AS horario_id,
        m.clave AS clave_materia,
        m.nombre AS nombre_materia,
        h.grupo,
        h.lunes, h.martes, h.miercoles, h.jueves, h.viernes, h.sabado, h.domingo
      FROM horario h
      JOIN materias m ON h.materia_id = m.id
      WHERE h.docente_id = $1 AND h.periodo = $2
      ORDER BY h.grupo, m.clave
    `, [docente_id, periodoActual]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener horario del docente', details: err.message });
  }
});

// Endpoint para obtener las materias que imparte el docente en el periodo actual
app.get('/api/materias-docente/:docente_id', async (req, res) => {
  const docente_id = parseInt(req.params.docente_id, 10);
  if (!docente_id) return res.json([]);
  try {
    const periodoActual = await getPeriodoActualNombre();
    const result = await pool.query(`
      SELECT DISTINCT
        m.id AS materia_id,
        m.clave AS clave_materia,
        m.nombre AS nombre_materia,
        h.grupo,
        h.periodo
      FROM horario h
      JOIN materias m ON h.materia_id = m.id
      WHERE h.docente_id = $1 AND h.periodo = $2
      ORDER BY h.grupo, m.clave
    `, [docente_id, periodoActual]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener materias del docente', details: err.message });
  }
});

// Endpoint para obtener los alumnos de una materia/grupo/periodo
app.get('/api/alumnos-materia/:materia_id/:grupo/:periodo', async (req, res) => {
  const materia_id = parseInt(req.params.materia_id, 10);
  const grupo = req.params.grupo;
  const periodo = req.params.periodo;
  if (!materia_id || !grupo || !periodo) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT a.id, a.no_control, a.nombre, a.apellido_paterno, a.apellido_materno
      FROM horario h
      JOIN alumnos a ON h.alumno_id = a.id
      WHERE h.materia_id = $1 AND h.grupo = $2 AND h.periodo = $3
      ORDER BY a.nombre, a.apellido_paterno, a.apellido_materno
    `, [materia_id, grupo, periodo]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener alumnos de la materia', details: err.message });
  }
});

// Endpoint para que el docente asigne calificación
app.post('/api/calificaciones-docente', async (req, res) => {
  const { alumno_id, materia_id, periodo, calificacion } = req.body;
  if (!alumno_id || !materia_id || !periodo || calificacion === undefined) {
    return res.status(400).json({ success: false, message: 'Datos incompletos' });
  }
  try {
    // Si ya existe, actualiza; si no, inserta
    const existe = await pool.query(
      'SELECT id FROM calificaciones WHERE alumno_id = $1 AND materia_id = $2 AND periodo = $3',
      [alumno_id, materia_id, periodo]
    );
    if (existe.rows.length > 0) {
      await pool.query(
        'UPDATE calificaciones SET calificacion = $1 WHERE alumno_id = $2 AND materia_id = $3 AND periodo = $4',
        [calificacion, alumno_id, materia_id, periodo]
      );
    } else {
      await pool.query(
        'INSERT INTO calificaciones (alumno_id, materia_id, periodo, calificacion) VALUES ($1, $2, $3, $4)',
        [alumno_id, materia_id, periodo, calificacion]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al guardar calificación', error: err.message });
  }
});

// Endpoint para obtener todos los periodos (solo nombres, para selects)
app.get('/api/periodos', async (req, res) => {
  try {
    const result = await pool.query('SELECT nombre FROM periodos ORDER BY id DESC');
    // Devuelve solo los nombres como arreglo plano
    res.json(result.rows.map(row => row.nombre));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener periodos', details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor corriendo en puerto ${port}`);
});


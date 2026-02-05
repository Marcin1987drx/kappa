const fs = require('fs');

// Load example data
const dataPath = require('path').join(__dirname, '..', 'example-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Load sql.js synchronously
const initSqlJs = require('sql.js');

initSqlJs().then(SQL => {
  const dbPath = require('path').join(__dirname, 'data', 'kappaplannung.db');
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // Clear existing data
  db.run('DELETE FROM project_weeks');
  db.run('DELETE FROM projects');
  db.run('DELETE FROM customers');
  db.run('DELETE FROM types');
  db.run('DELETE FROM parts');
  db.run('DELETE FROM tests');
  
  // Import customers
  data.customers.forEach(c => {
    db.run('INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)', [c.id, c.name, c.createdAt || Date.now()]);
  });
  
  // Import types
  data.types.forEach(t => {
    db.run('INSERT INTO types (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.createdAt || Date.now()]);
  });
  
  // Import parts
  data.parts.forEach(p => {
    db.run('INSERT INTO parts (id, name, created_at) VALUES (?, ?, ?)', [p.id, p.name, p.createdAt || Date.now()]);
  });
  
  // Import tests
  data.tests.forEach(t => {
    db.run('INSERT INTO tests (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.createdAt || Date.now()]);
  });
  
  // Import projects
  const year = new Date().getFullYear();
  data.projects.forEach(p => {
    db.run('INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [p.id, p.customer_id || p.customerId, p.type_id || p.typeId, p.part_id || p.partId, p.test_id || p.testId, p.created_at || p.createdAt || Date.now(), p.updated_at || p.updatedAt || Date.now()]);
    
    if (p.weeks) {
      for (const [week, wdata] of Object.entries(p.weeks)) {
        const weekKey = week.includes('-') ? week : year + '-' + week;
        db.run('INSERT INTO project_weeks (project_id, week, ist, soll) VALUES (?, ?, ?, ?)', [p.id, weekKey, wdata.ist, wdata.soll]);
      }
    }
  });
  
  // Save
  const dbData = db.export();
  const buffer2 = Buffer.from(dbData);
  fs.writeFileSync(dbPath, buffer2);
  
  // Write log
  fs.writeFileSync(require('path').join(__dirname, 'import-log.txt'), 
    'Imported: ' + data.customers.length + ' customers, ' + 
    data.types.length + ' types, ' + 
    data.parts.length + ' parts, ' + 
    data.tests.length + ' tests, ' + 
    data.projects.length + ' projects\nSUCCESS');
    
  process.exit(0);
}).catch(err => {
  fs.writeFileSync(require('path').join(__dirname, 'import-log.txt'), 'ERROR: ' + err.message);
  process.exit(1);
});

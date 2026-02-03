DELETE FROM project_weeks;
DELETE FROM projects;
DELETE FROM customers;
DELETE FROM types;
DELETE FROM parts;
DELETE FROM tests;

INSERT INTO customers (id, name, created_at) VALUES ('c1', 'Porsche', 1737972000000);
INSERT INTO customers (id, name, created_at) VALUES ('c2', 'Tesla', 1737972000000);
INSERT INTO customers (id, name, created_at) VALUES ('c3', 'VW', 1737972000000);
INSERT INTO customers (id, name, created_at) VALUES ('c4', 'Mercedes', 1737972000000);
INSERT INTO customers (id, name, created_at) VALUES ('c5', 'BMW', 1737972000000);

INSERT INTO types (id, name, created_at) VALUES ('t1', 'G3', 1737972000000);
INSERT INTO types (id, name, created_at) VALUES ('t2', 'Model Y', 1737972000000);
INSERT INTO types (id, name, created_at) VALUES ('t3', '310', 1737972000000);
INSERT INTO types (id, name, created_at) VALUES ('t4', 'E-Class', 1737972000000);
INSERT INTO types (id, name, created_at) VALUES ('t5', 'iX', 1737972000000);

INSERT INTO parts (id, name, created_at) VALUES ('p1', 'Abdeckung HUD', 1737972000000);
INSERT INTO parts (id, name, created_at) VALUES ('p2', 'Front Door', 1737972000000);
INSERT INTO parts (id, name, created_at) VALUES ('p3', 'Rear Door', 1737972000000);
INSERT INTO parts (id, name, created_at) VALUES ('p4', 'Z Blenda FS LL', 1737972000000);
INSERT INTO parts (id, name, created_at) VALUES ('p5', 'Z Blenda BFS LL', 1737972000000);

INSERT INTO tests (id, name, created_at) VALUES ('te1', 'Produkt Audit', 1737972000000);
INSERT INTO tests (id, name, created_at) VALUES ('te2', 'Peel off test', 1737972000000);
INSERT INTO tests (id, name, created_at) VALUES ('te3', 'Messlehre', 1737972000000);
INSERT INTO tests (id, name, created_at) VALUES ('te4', 'Passeinlage', 1737972000000);

INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES ('pr1', 'c1', 't1', 'p1', 'te1', 1737972000000, 1737972000000);
INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES ('pr2', 'c2', 't2', 'p2', 'te2', 1737972000000, 1737972000000);
INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES ('pr3', 'c3', 't3', 'p3', 'te3', 1737972000000, 1737972000000);

INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr1', '2026-KW01', 20, 28);
INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr1', '2026-KW02', 25, 26);
INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr1', '2026-KW03', 32, 32);
INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr2', '2026-KW01', 15, 20);
INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr2', '2026-KW02', 18, 20);
INSERT INTO project_weeks (project_id, week, ist, soll) VALUES ('pr3', '2026-KW01', 10, 15);

INSERT INTO employees (id, firstName, lastName, color, status, created_at) VALUES ('emp1', 'Jan', 'Kowalski', '#E91E63', 'available', 1737972000000);
INSERT INTO employees (id, firstName, lastName, color, status, created_at) VALUES ('emp2', 'Anna', 'Nowak', '#9C27B0', 'available', 1737972000000);
INSERT INTO employees (id, firstName, lastName, color, status, created_at) VALUES ('emp3', 'Piotr', 'Wiśniewski', '#673AB7', 'available', 1737972000000);

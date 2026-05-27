import psycopg2
conn = psycopg2.connect(host='localhost', port=5433, dbname='financial_analyst', user='postgres')
cur = conn.cursor()
cur.execute('''SELECT s.id, s.date_debut, s.date_fin, c.no_contrat, e.nom as employe
FROM bt_semaines s 
JOIN bt_contrats c ON s.contrat_id = c.id 
JOIN bt_employes e ON s.employe_id = e.id 
ORDER BY s.date_debut DESC LIMIT 5''')
rows = cur.fetchall()
print('Dernieres semaines:')
for r in rows:
    print(f'  ID={r[0]} | {r[1]} a {r[2]} | contrat={r[3]} | employe={r[4]}')

cur.execute('SELECT COUNT(*) FROM bt_semaines')
print(f'Total semaines: {cur.fetchone()[0]}')

cur.execute('SELECT COUNT(*) FROM bt_employes WHERE actif=true')
print(f'Employes actifs: {cur.fetchone()[0]}')

conn.close()
from os import environ

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

database_url = make_url(environ["DATABASE_URL"]).set(drivername="postgresql+psycopg")

if context.is_offline_mode():
    context.configure(url=database_url, literal_binds=True, transactional_ddl=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(database_url, poolclass=NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(894112503)")
            context.run_migrations()

from typing import Annotated

import psycopg
from fastapi import Depends

from .config import connection


def get_database():
    with connection() as database:
        yield database


Database = Annotated[psycopg.Connection, Depends(get_database, scope="function")]

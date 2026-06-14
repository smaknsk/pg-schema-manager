FROM alpine/psql:18.3

COPY src /pgschema/src
COPY bin /pgschema/bin

ENTRYPOINT ["/pgschema/bin/entrypoint.sh"]

CMD ["sh", "/pgschema/bin/migrate.sh"]

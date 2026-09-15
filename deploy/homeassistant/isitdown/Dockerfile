# The add-on is the published image plus one script. Nothing is rebuilt: the
# engine, the dashboard bundle and the healthcheck all come from the tag below,
# so an add-on update is a pull rather than a build of this project's source.
ARG BUILD_FROM
FROM ${BUILD_FROM}

# The Supervisor mounts the add-on's persistent volume at /data and hands the
# add-on its options as /data/options.json, so both the database and the
# credentials live there rather than where the plain container keeps them.
ENV DB_PATH=/data/isitdown.db

# Root, because /data arrives owned by root and an add-on is expected to run as
# one. The image's own user is left behind here and nowhere else.
USER root
COPY run.mjs /app/run.mjs

CMD ["node", "/app/run.mjs"]

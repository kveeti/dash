create table users (
    id varchar(30) not null primary key,
    external_id varchar(36) not null unique
);

create table sessions (
    id varchar(30) not null primary key,
    user_id varchar(30) not null
);

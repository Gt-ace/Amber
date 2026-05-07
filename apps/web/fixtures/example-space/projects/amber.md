---
title: Amber
description: A self-hostable personal canvas — link-in-bio, small site, notebook.
tags: [software, in-progress, self-hosted]
---

Amber is the thing I keep wishing existed: a small piece of software you run on
your own server, that turns a folder of markdown files into a website. No
database lock-in, no platform, no migration story when the platform shuts down.

I've been working on it on and off for about six months. The current shape is
a SvelteKit app with a watcher that keeps an in-memory index of a directory
tree, and a SQLite cache that exists only as an optimization — you can delete
it and the site still works.

The license is AGPL-3.0 because I want people to be able to use this without
having to pay anyone, and I don't want it eaten and resold.

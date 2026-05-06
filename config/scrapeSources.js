const venueRegistry = require("./venueRegistry");

module.exports = venueRegistry
  .filter((entry) => entry && entry.active && entry.agendaUrl)
  .map((entry) => entry.agendaUrl);

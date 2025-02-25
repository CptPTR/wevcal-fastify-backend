import cors from "@fastify/cors";
import FastifySwagger from "@fastify/swagger";
import FastifySwaggerUi from "@fastify/swagger-ui";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import Fastify from "fastify";
import { google } from "googleapis";
import nodemailer from "nodemailer";

dotenv.config()

const PORT = 3001;
const fastify = Fastify({
  logger: true,
});

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.split(String.raw`\n`).join('\n'),
  scopes: SCOPES,
});

const calendar = google.calendar({ version: "v3", auth });

const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_AUTH_USER,
    pass: process.env.SMTP_AUTH_PASS
  }
})

fastify.register(cors)
fastify.register(FastifySwagger, {
  swagger: {
    info: {
      title: "fastify-api",
    },
  },
});
fastify.register(FastifySwaggerUi, {
  routePrefix: "/docs",
});

const supabase = createClient(process.env.APP_SUPABASE_URL, process.env.APP_SUPABASE_ANON_KEY)

fastify.get("/calendars/:username/events", async (request, reply) => {
  const { username } = request.params;

  const { data, error } = await supabase.from("gebruikers").select("*").eq("gebruikersnaam", username)

  if (error) {
    reply.code(500).send({ error: "Datebase error" })
  }

  if (!data || data.length === 0) {
    reply.code(404).send({ error: `User ${username} not found` })
  }

  const calendarId = data[0].email;

  const res = await calendar.events.list(
    {
      calendarId,
      maxResults: 3,
      singleEvents: true,
      orderBy: "startTime",
    }
  )
  reply.send({ events: res.data.items })
});

fastify.post("/calendars/:username/events", async (request, reply) => {
  const { username } = request.params;
  const { eventSummary, eventLocation, eventDescription, eventStart, eventEnd } = request.body;

  const { data, error } = await supabase.from("gebruikers").select("*").eq("gebruikersnaam", username)

  if (error) {
    reply.code(500).send({ error: "Datebase error" })
  }

  if (!data || data.length === 0) {
    reply.code(404).send({ error: `User ${username} not found` })
  }

  const calendarId = data[0].email;

  const res = await calendar.events.insert(
    {
      calendarId,
      requestBody: {
        summary: eventSummary,
        location: eventLocation,
        description: eventDescription,
        start: {
          dateTime: eventStart,
          timeZone: "Europe/Brussels",
        },
        end: {
          dateTime: eventEnd,
          timeZone: "Europe/Brussels",
        },
      },
    }
  );

  reply.send(res.data.id)
});

fastify.put("/calendars/:username/events/:eventId", async (request, reply) => {
  const { username, eventId } = request.params
  const { eventStart, eventEnd } = request.body

  const { data, error } = await supabase.from("gebruikers").select("*").eq("gebruikersnaam", username)

  if (error) {
    reply.code(500).send({ error: "Datebase error" })
  }

  if (!data || data.length === 0) {
    reply.code(404).send({ error: `User ${username} not found` })
  }

  const calendarId = data[0].email;

  const { data: retrievedEvent } = await calendar.events.get({
    calendarId,
    eventId
  })

  const updatedEvent = {
    ...retrievedEvent,
    start: {
      dateTime: eventStart,
      timeZone: "Europe/Brussels"
    },
    end: {
      dateTime: eventEnd,
      timeZone: "Europe/Brussels"
    }
  }

  const res = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: updatedEvent
  })

  reply.send(res.data)
})

fastify.delete("/calendars/:username/events/:eventId", async (request, reply) => {
  const { username, eventId } = request.params

  const { data, error } = await supabase.from("gebruikers").select("*").eq("gebruikersnaam", username)

  if (error) {
    reply.code(500).send({ error: "Datebase error" })
  }

  if (!data || data.length === 0) {
    reply.code(404).send({ error: `User ${username} not found` })
  }

  const calendarId = data[0].email;

  const res = await calendar.events.delete({
    calendarId,
    eventId
  })

  reply.send(res)
})

fastify.post("/send-mail", async (request, reply) => {
  const { to, subject, type, link } = request.body

  await transporter.sendMail({
    from: process.env.SMTP_AUTH_USER,
    to,
    subject,
    html: `<p> Er is een nieuwe keuringsaanvraag binnengekomen voor ${type.replace('/', ' + ')}</p> <p>Bekijk de details van deze keuring via de volgende link: <a href=${link}>${link}</a></p>`
  })

  reply.send({ message: "Email sent successfully" })
})

fastify.post("/notify-certificate-available", async (request, reply) => {
  const { to, subject, location, klant, type, link } = request.body

  await transporter.sendMail({
    from: process.env.SMTP_AUTH_USER,
    to,
    subject,
    html: `
      <p>Beste, </p>
      <p>Er is een attest beschikbaar voor de volgende keuring</p>
      <ul>
        <li>
          <b>Type:</b> ${type}
        </li>
        <li>
          <b>Adres:</b> ${location}
        </li>
        <li>
          <b>Klant:</b> ${klant}
        </li>
      </ul>
      <p>Klik op de onderstaande link om het attest te raadplegen:</p>
      <a href="${link}">${link}</a>
      <p>Indien er een attest ontbreekt, zal dit spoedig beschikbaar worden gesteld.</p>
      <p>Met vriendelijke groet,</p>
      <p>Het WoonExpertVlaanderen team</p>
    `
  })
})

fastify.post("/notify-updated-date-visit", async (request, reply) => {
  const { to, subject, location, klant, date, type } = request.body

  await transporter.sendMail({
    from: process.env.SMTP_AUTH_USER,
    to,
    subject,
    html: `<p>Beste, </p><p>De volgende keuring in ons systeem is gepland voor <b>${date}</b>. <ul><li>Type: ${type.join(" & ")}</li><li>Locatie: ${location}</li><li>Klant: ${klant}</li></ul><p>Neem contact met me op als u vragen hebt over de planning.</p>`
  })
})

try {
  await fastify.listen({ host: "0.0.0.0", port: PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

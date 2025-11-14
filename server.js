import cors from "@fastify/cors";
import FastifySwagger from "@fastify/swagger";
import FastifySwaggerUi from "@fastify/swagger-ui";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import Fastify from "fastify";
import { google } from "googleapis";
import { Resend } from "resend"

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

const resend = new Resend(process.env.RESEND_API_KEY)

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

const getUser = async (username) => {
  const { data, error } = await supabase.from("gebruikers").select("*").eq("gebruikersnaam", username).single()

  if (error) throw new Error("Database error")
  if (!data) throw new Error(`User ${username} not found`)

  return data
}

fastify.get("/calendars/:username/events", async (request, reply) => {
  try {

    const { username } = request.params;
    const user = await getUser(username);

    const res = await calendar.events.list(
      {
        calendarId: user.email,
        maxResults: 3,
        singleEvents: true,
        orderBy: "startTime",
      }
    )

    return res.data.items;
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
});

fastify.post("/calendars/:username/events", async (request, reply) => {
  try {

    const { username } = request.params;
    const { eventSummary, eventLocation, eventDescription, eventStart, eventEnd } = request.body;
    const user = await getUser(username);

    const res = await calendar.events.insert(
      {
        calendarId: user.email,
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

    return res.data.id
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }

});

fastify.put("/calendars/:username/events/:eventId", async (request, reply) => {
  try {
    const { username, eventId } = request.params
    const { eventStart, eventEnd } = request.body
    const user = await getUser(username)

    const { data: retrievedEvent } = await calendar.events.get({
      calendarId: user.email,
      eventId
    })

    const updatedEvent = {
      ...retrievedEvent,
      sequence: (retrievedEvent.sequence || 0) + 1,
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
      calendarId: user.email,
      eventId,
      requestBody: updatedEvent
    })

    return res.data
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
})

fastify.delete("/calendars/:username/events/:eventId", async (request, reply) => {
  try {

    const { username, eventId } = request.params
    const user = await getUser(username)

    const res = await calendar.events.delete({
      calendarId: user.email,
      eventId
    })

    return { success: true }
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
})

fastify.post("/send-mail", async (request, reply) => {
  try {
    const { to, subject, type, link } = request.body

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html: `<p> Er is een nieuwe keuringsaanvraag binnengekomen voor ${type.replace('/', ' + ')}</p> <p>Bekijk de details van deze keuring via de volgende link: <a href=${link}>${link}</a></p>`
    })

    return { message: "Email sent successfully" }
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
})

fastify.post("/notify-certificate-available", async (request, reply) => {
  try {

    const { to, subject, location, klant, type, link } = request.body

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
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

    return { message: "Email sent successfully" }
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
})

fastify.post("/notify-updated-date-visit", async (request, reply) => {
  try {

    const { to, subject, location, klant, date, type } = request.body

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html: `<p>Beste, </p><p>De volgende keuring in ons systeem is gepland voor <b>${date}</b>. <ul><li>Type: ${type.join(" & ")}</li><li>Locatie: ${location}</li><li>Klant: ${klant}</li></ul><p>Neem contact met me op als u vragen hebt over de planning.</p>`
    })

    return { message: "Email sent successfully" }
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  }
})

try {
  await fastify.listen({ host: "0.0.0.0", port: PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

import Koa from "koa";
import Router from "koa-router";
import bodyParser from "koa-bodyparser";
import * as http from "http";
import * as fs from "fs";
import util from "util";
import {
	object,
	string,
	chain,
	transform,
	Validator,
	InferType,
	fallback,
} from "./validator";
import * as path from "path";

const instanceDomain = process.env.DOMAIN;

const databasePath = path.resolve(`${__dirname}/../database.json`);

const app = new Koa();
app.use(bodyParser());

const router = new Router();

const json = <T>(v: Validator<T>) =>
	chain(
		transform((v) => JSON.parse(v)),
		v
	);

const userSchema = json(
	object({
		id: string(),
		name: string(),
		summary: fallback(string(), () => ""),
	})
);

type User = InferType<typeof userSchema> & {
	published: string;
	profilePicture: string;
};

type Db = {
	users: User[];
};

async function getDb(): Promise<Db> {
	try {
		await util.promisify(fs.stat)(databasePath);
	} catch (e) {
		await util.promisify(fs.writeFile)(databasePath, "{}");
	}
	const db = JSON.parse(
		(await util.promisify(fs.readFile)(databasePath)).toString("utf8")
	);
	return db;
}

async function saveDb(partial: Partial<Db>) {
	const db = await getDb();
	await util.promisify(fs.writeFile)(
		databasePath,
		JSON.stringify({ ...db, ...partial })
	);
}

type Resource = {
	username: string;
	domain: string;
};

function parseWebFingerResource(resource: string): Resource {
	const [username, domain] = resource.split("@");
	if (!domain) {
		throw new Error("Invalid resource");
	}
	return { username, domain };
}

router.post("/users", async (ctx, next) => {
	const validation = userSchema.validate(ctx.request.body);
	if (!validation.isValid) {
		ctx.response.status = 400;
		return;
	}
	const newUser = validation.value;

	const db = await getDb();
	const users = db.users || [];

	const user = users.find((v) => v.id === newUser.id);
	if (user) {
		ctx.response.status = 409;
		return;
	}

	users.push({
		...newUser,
		published: new Date().toISOString(),
		profilePicture:
			"https://static-cdn.mastodon.social/avatars/original/missing.png",
	});

	await saveDb({ users });
});

router.get("/.well-known/webfinger", async (ctx, next) => {
	const resource = ctx.params.resource;

	if (!resource) {
		ctx.response.status = 400;
		return;
	}

	try {
		const { username, domain } = parseWebFingerResource(resource);

		if (domain !== instanceDomain) {
			ctx.response.status = 501;
			return;
		}

		const db = await getDb();
		const users = db.users || [];

		const user = users.find((v) => v.id === username);
		if (!user) {
			ctx.response.status = 400;
			return;
		}

		ctx.response.body = {
			subject: `acct:${resource}`,
			// aliases: [
			// 	`https://mastodon.social/@${username}`,
			// 	`https://mastodon.social/users/${username}`,
			// ],
			links: [
				// {
				// 	rel: "http://webfinger.net/rel/profile-page",
				// 	type: "text/html",
				// 	href: "https://mastodon.social/@manlycoffee",
				// },
				{
					rel: "self",
					type: "application/activity+json",
					href: `https://${instanceDomain}/users/manlycoffee`,
				},
				// {
				// 	rel: "http://ostatus.org/schema/1.0/subscribe",
				// 	template: "https://mastodon.social/authorize_interaction?uri={uri}",
				// },
			],
		};
	} catch (e) {
		ctx.response.status = 400;
		return;
	}
});

router.get("/users/:id", async (ctx, next) => {});

app.use(router.routes());

app.listen(3030, function (this: http.Server) {
	console.log(this.address());
});

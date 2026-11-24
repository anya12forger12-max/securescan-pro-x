import pg from "pg";
import { randomInt } from "node:crypto";
import { dbPoolOptions } from "@gp/config";
const { Pool } = pg;
// A game needs a board before anyone can submit a clue or a guess. The
// recovered service only inserted ids, leaving every word list empty, so a
// freshly created game was permanently unplayable. Generate the standard
// 25-word board here (9/8 coloured, 7 neutral, 1 assassin) using a
// cryptographic shuffle so layouts cannot be predicted by clients.
const WORD_BANK = [
    "AFRICA", "AGENT", "AIR", "ALIEN", "ANGEL", "APPLE", "ARCTIC", "ARM",
    "BALLOON", "BANANA", "BAR", "BASIL", "BEACH", "BEAR", "BENGAL", "BICYCLE",
    "BIRD", "BOMB", "BONUS", "BOOK", "BOTTLE", "BOUNTY", "BRIDGE", "BROOKLYN",
    "BUCKET", "CABIN", "CACTUS", "CAMERA", "CAMP", "CANADA", "CANDLE", "CANNON",
    "CAPITAL", "CAR", "CARIBBEAN", "CASTLE", "CAT", "CELL", "CENTER", "CHAIN",
    "CHAIR", "CHARGE", "CHEF", "CHERRY", "CHEST", "CHICKEN", "CIRCLE", "CLIP",
    "CLOCK", "CLOWN", "CLUB", "COAST", "COFFEE", "COLD", "COMBAT", "COMET",
    "CORAL", "COTTON", "COURT", "COVER", "CRANE", "CRASH", "CRAYON", "CREAM",
    "CREDIT", "CRICKET", "CROWN", "CRUISE", "CRYSTAL", "CUBE", "CULTURE", "CUP",
    "DANCE", "DESERT", "DIAMOND", "DICE", "DINOSAUR", "DIRECTION", "DOG", "DOLL",
    "DOLPHIN", "DOMINO", "DONKEY", "DRAW", "DREAM", "DRESS", "DRIFT", "DRUM",
    "EAGLE", "EARTH", "EGG", "ELEPHANT", "ENERGY", "ENGINE", "EUROPE", "FABLE",
    "FAIRY", "FALL", "FAN", "FARM", "FENCE", "FERRY", "FIELD", "FIRE", "FISH",
    "FLAG", "FLAME", "FLASH", "FLOOD", "FLUTE", "FOOT", "FOREST", "FORK",
    "FORT", "FOUNTAIN", "FRAME", "FROG", "FRUIT", "FUEL", "GAME", "GARDEN",
    "GAS", "GATE", "GEAR", "GEM", "GHOST", "GIANT", "GIFT", "GIRL", "GLASS",
    "GLOBE", "GLOVE", "GOAT", "GOLD", "GRAVITY", "GREEN", "GUITAR", "GUN",
    "HAMMER", "HAMSTER", "HARBOR", "HAT", "HAWK", "HEART", "HELICOPTER", "HIMALAYA",
    "HIVE", "HOLE", "HONEY", "HORSE", "HOSPITAL", "HOTEL", "HOUSE", "ICE",
    "ICECREAM", "ICON", "IGLOO", "ISLAND", "JACKET", "JAGUAR", "JAM", "JET",
    "JEWEL", "JUNGLE", "KANGAROO", "KEY", "KID", "KITE", "KNIFE", "LAB",
    "LADDER", "LAKE", "LAMP", "LAPTOP", "LEAF", "LEMON", "LEPRECHAUN", "LICENSE",
    "LIGHT", "LIMIT", "LION", "LIZARD", "LOCK", "LOLLIPOP", "LONDON", "LUCK",
    "LUNCH", "MAGIC", "MAGNET", "MAPLE", "MARBLE", "MARCH", "MASCOT", "MAZE",
    "MEADOW", "METAL", "MICROSCOPE", "MIDDLE", "MILK", "MIRROR", "MISSILE", "MODEL",
    "MONEY", "MONKEY", "MONTH", "MOON", "MOUSE", "MOUTH", "MOVIE", "MUG",
    "MUSHROOM", "MUSIC", "MYSTERY", "NEEDLE", "NEST", "NET", "NEWSPAPER", "NIGHT",
    "NINJA", "NOTE", "NOVEL", "NURSE", "OCEAN", "OCTOPUS", "OFFICE", "ORANGE",
    "ORBIT", "ORGAN", "OWL", "OX", "OXYGEN", "PALM", "PAN", "PANDA", "PAPER",
    "PARIS", "PARTY", "PASSPORT", "PASTA", "PATCH", "PAWN", "PEACH", "PEARL",
    "PENGUIN", "PENCIL", "PHANTOM", "PHONE", "PHOTO", "PIANO", "PILOT", "PINE",
    "PIPE", "PIRATE", "PISTOL", "PIZZA", "PLANET", "PLASTIC", "PLATE", "PLAY",
    "PLEASURE", "PLUMBER", "POISON", "POLICE", "POOL", "PORT", "POST", "POTATO",
    "POWER", "PRESS", "PRINCESS", "PRISON", "PUZZLE", "PYRAMID", "QUEEN", "QUILT",
    "RABBIT", "RADIO", "RAIN", "RAINBOW", "RAM", "RAMP", "RATION", "RATTLE",
    "REACTOR", "REFRIGERATOR", "RING", "RIVER", "ROAD", "ROBOT", "ROCK", "ROCKET",
    "ROPE", "ROSE", "ROYAL", "RULER", "SABER", "SAIL", "SALAD", "SAND",
    "SCALE", "SCHOOL", "SCIENTIST", "SCREEN", "SCREWDRIVER", "SHADOW", "SHAFT", "SHAKE",
    "SHARK", "SHEEP", "SHELF", "SHELL", "SHIP", "SHOE", "SHOP", "SHOT",
    "SHOW", "SIDE", "SIGN", "SILK", "SILVER", "SKATE", "SKI", "SKULL",
    "SLEEP", "SLICE", "SLIDE", "SLOPE", "SNAKE", "SNOW", "SOCKET", "SOFA",
    "SOFT", "SOLAR", "SOLDIER", "SOLID", "SOLUTION", "SONG", "SPACE", "SPARK",
    "SPEED", "SPIDER", "SPIKE", "SPOON", "SPORT", "SPRING", "SPY", "SQUARE",
    "SQUIRREL", "STADIUM", "STAR", "STATION", "STEAM", "STEEL", "STICK", "STILL",
    "STOCK", "STONE", "STORE", "STORM", "STORY", "STRANGER", "STRAP", "STRAW",
    "STRIPE", "STUDENT", "STUFF", "SUGAR", "SUIT", "SUMMER", "SUN", "SUNGLASSES",
    "SUPERHERO", "SURF", "SURGEON", "SUSPECT", "SWAMP", "SWING", "SWITCH", "SWORD",
    "TABLE", "TANK", "TAPE", "TARGET", "TAXI", "TEACHER", "TELEPHONE", "TELESCOPE",
    "TENNIS", "THEATER", "TICKET", "TIGER", "TIMER", "TIRE", "TITLE", "TOAST",
    "TOKEN", "TOMATO", "TOOTH", "TORCH", "TORNADO", "TOWER", "TOWN", "TOY",
    "TRACK", "TRADE", "TRAFFIC", "TRAIL", "TRAIN", "TRAMPOLINE", "TRAP", "TRAVEL",
    "TREAT", "TREE", "TRICK", "TRIP", "TROPHY", "TRUCK", "TRUMPET", "TRUNK",
    "TRUST", "TUBE", "TUNNEL", "TURKEY", "TURN", "TURTLE", "TWINS", "UMBRELLA",
    "UNICORN", "UNIFORM", "UNIVERSE", "VACATION", "VACCINE", "VALLEY", "VAMPIRE", "VAN",
    "VANILLA", "VASE", "VEGETABLE", "VEHICLE", "VELVET", "VENUS", "VERTEX", "VIOLIN",
    "VIRUS", "VISOR", "VOLCANO", "VOLLEYBALL", "WAGON", "WALL", "WALLET", "WAR",
    "WASHINGTON", "WATCH", "WATER", "WAVE", "WEAPON", "WEATHER", "WEB", "WEDDING",
    "WEEKEND", "WEIGHT", "WHALE", "WHEAT", "WHEEL", "WHIP", "WHISTLE", "WITCH",
    "WIZARD", "WOOD", "WOOL", "WORD", "WORLD", "WORM", "WORSHIP", "WOUNDED",
    "WRENCH", "WRIST", "WRITE", "WRONG", "YACHT", "YARD", "YEAR", "YOGA",
    "YOGURT", "ZEBRA", "ZONE",
];
function shuffled(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
function buildBoard() {
    // Red starts, so red receives the extra card under Codenames rules.
    const words = shuffled(WORD_BANK).slice(0, 25);
    return {
        red: words.slice(0, 9),
        blue: words.slice(9, 17),
        neutral: words.slice(17, 24),
        assassin: words[24],
    };
}
const pools = new Map();
export function getPool(connectionString) {
    let pool = pools.get(connectionString);
    if (!pool) {
        pool = new Pool(dbPoolOptions(connectionString));
        pools.set(connectionString, pool);
    }
    return pool;
}
export async function closePool() {
    await Promise.all([...pools.values()].map((p) => p.end()));
    pools.clear();
}
export async function createGame(pool, input) {
    // Seed the secret board at creation time. Before this fix every new game
    // had empty word lists and could never be played.
    const board = buildBoard();
    const result = await pool.query(`INSERT INTO codenames_games
     (id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word, status, current_team, winner, created_at, ended_at`, [input.id, input.session_id, input.host_id, board.red, board.blue, board.neutral, board.assassin]);
    return result.rows[0];
}
export async function getGame(pool, id) {
    const result = await pool.query(`SELECT id, session_id, host_id, red_team_words, blue_team_words, neutral_words, assassin_word, status, current_team, winner, created_at, ended_at
     FROM codenames_games WHERE id = $1`, [id]);
    return result.rows[0];
}
/**
 * Codenames has no persisted team column. Use session join order as the
 * house-rule assignment: first/third/... seat is red, second/fourth/... blue.
 * This makes the server, not the client, authoritative for a player's team.
 */
export async function playerTeam(pool, sessionId, userId) {
    const result = await pool.query(`SELECT team FROM (
       SELECT user_id,
              CASE WHEN row_number() OVER (ORDER BY joined_at, user_id) % 2 = 1
                   THEN 'red' ELSE 'blue' END AS team
         FROM game_players WHERE session_id = $1
     ) seats WHERE user_id = $2`, [sessionId, userId]);
    return result.rows[0]?.team ?? null;
}
/** The first seat of each team is that team's spymaster. */
export async function isTeamSpymaster(pool, sessionId, userId, team) {
    const result = await pool.query(`SELECT user_id FROM (
       SELECT user_id, team,
              row_number() OVER (PARTITION BY team ORDER BY joined_at, user_id) AS seat
         FROM (
           SELECT user_id, joined_at,
                  CASE WHEN row_number() OVER (ORDER BY joined_at, user_id) % 2 = 1
                       THEN 'red' ELSE 'blue' END AS team
             FROM game_players WHERE session_id = $1
         ) seats
     ) ranked WHERE team = $2 AND seat = 1`, [sessionId, team]);
    return result.rows[0]?.user_id === userId;
}
/** Conditional status write. The route validates the transition, but only the
 * WHERE clause makes it atomic: a delayed request cannot reopen a game that
 * another request already moved on. */
export async function isSessionParticipant(pool, sessionId, userId, gameType = "codenames") {
    const result = await pool.query(`SELECT 1 FROM game_sessions s
       JOIN game_players p ON p.session_id = s.id
      WHERE s.id = $1 AND s.game_type = $2
        AND s.status IN ('waiting', 'active') AND p.user_id = $2
      LIMIT 1`, [sessionId, gameType, userId]);
    return (result.rowCount ?? 0) > 0;
}
/** A game must only ever be attached to a session of this game type. */
export async function isSessionOfType(pool, sessionId, gameType) {
    const result = await pool.query(`SELECT 1 FROM game_sessions
      WHERE id = $1 AND game_type = $2 AND status IN ('waiting', 'active')
      LIMIT 1`, [sessionId, gameType]);
    return (result.rowCount ?? 0) > 0;
}
/** Starting a game is the moment play begins: close the session's join window
 * so a late seat cannot change team assignment or leaderboard eligibility.
 * The game_type predicate keeps a codenames game from activating a session
 * that belongs to another game. */
export async function activateSession(pool, sessionId, gameType) {
    await pool.query(`UPDATE game_sessions SET status = 'active'
      WHERE id = $1 AND status = 'waiting' AND game_type = $2`, [sessionId, gameType]);
}
export async function setGameStatus(pool, id, status, expectedStatus) {
    const params = [id, status];
    let guard = "";
    if (expectedStatus) {
        const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
        const placeholders = allowed.map((value) => `$${params.push(value)}`).join(", ");
        guard = ` AND status IN (${placeholders})`;
    }
    const result = await pool.query(`UPDATE codenames_games
        SET status = $2, ended_at = CASE WHEN $2 = 'ended' THEN now() ELSE ended_at END
      WHERE id = $1${guard} RETURNING id`, params);
    return (result.rowCount ?? 0) > 0;
}
export async function submitClue(pool, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const locked = await client.query(`SELECT status, current_team FROM codenames_games WHERE id = $1 FOR UPDATE`, [input.game_id]);
        if (!locked.rowCount || locked.rows[0].status !== "active" || locked.rows[0].current_team !== input.team) {
            await client.query("ROLLBACK");
            return null;
        }
        const active = await client.query(`SELECT id, team, number FROM codenames_clues
        WHERE game_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [input.game_id]);
        const activeClue = active.rows[0];
        if (activeClue && activeClue.team === input.team) {
            const used = await client.query(`SELECT COUNT(*)::int AS count FROM codenames_guesses WHERE clue_id = $1`, [activeClue.id]);
            if (Number(used.rows[0].count) < Number(activeClue.number)) {
                await client.query("ROLLBACK");
                return null;
            }
        }
        const result = await client.query(`INSERT INTO codenames_clues (id, game_id, spymaster_id, word, number, team)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, game_id, spymaster_id, word, number, team, created_at`, [input.id, input.game_id, input.spymaster_id, input.word, input.number, input.team]);
        await client.query("COMMIT");
        return result.rows[0];
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
export async function getCluesForGame(pool, gameId) {
    const result = await pool.query(`SELECT id, game_id, spymaster_id, word, number, team, created_at
     FROM codenames_clues WHERE game_id = $1
     ORDER BY created_at DESC`, [gameId]);
    return result.rows;
}
/** The active guessing turn is only valid when the most recent clue belongs to
 * the team whose turn it is. Historical rows with a NULL team predate the
 * team-scoped clue migration and are deliberately treated as no clue. */
export async function getActiveClue(pool, gameId) {
    const result = await pool.query(`SELECT id, game_id, spymaster_id, word, number, team, created_at
       FROM codenames_clues WHERE game_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 1`, [gameId]);
    return result.rows[0] ?? null;
}
// A correct guess or the assassin also reveals a card and ends the game.
// submitGuess owns the whole read-modify-write chain in one transaction so a
// dropped connection cannot leave a recorded guess with no matching game state.
export async function submitGuess(pool, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Lock the game row before recording the guess. The status check in the
        // route is outside this transaction; without the lock, two winning guesses
        // could both commit and the last winner update would silently overwrite.
        const locked = await client.query(`SELECT status, winner, red_team_words, blue_team_words
         FROM codenames_games WHERE id = $1 FOR UPDATE`, [input.game_id]);
        if (!locked.rowCount || locked.rows[0].status !== "active" || locked.rows[0].winner) {
            await client.query("ROLLBACK");
            return null;
        }
        // A guess is only legal while the most recent clue belongs to the team
        // whose turn it is, and the allowance is counted against that exact clue.
        // Without both checks a player could guess with no spymaster clue at all,
        // or spend an opponent's leftover allowance after a turn flip.
        const clue = await client.query(`SELECT id, team, number FROM codenames_clues
        WHERE game_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [input.game_id]);
        const active = clue.rows[0];
        if (!active || active.team !== input.team) {
            await client.query("ROLLBACK");
            return null;
        }
        if (input.clue_id !== active.id) {
            await client.query("ROLLBACK");
            return null;
        }
        const used = await client.query(`SELECT COUNT(*)::int AS count FROM codenames_guesses WHERE clue_id = $1`, [active.id]);
        if (Number(used.rows[0].count) >= Number(active.number)) {
            await client.query("ROLLBACK");
            return null;
        }
        const result = await client.query(`INSERT INTO codenames_guesses (id, game_id, user_id, username, word, team, outcome, clue_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, game_id, user_id, username, word, team, outcome, clue_id, created_at`, [input.id, input.game_id, input.user_id, input.username, input.word, input.team, input.outcome, active.id]);
        const guess = result.rows[0];
        if (input.outcome === "correct" || input.outcome === "assassin") {
            // The assassin belongs to neither team; record it as such rather
            // than pretending it was printed for the winning side.
            await revealWord(client, {
                game_id: input.game_id,
                word: input.word,
                team: input.outcome === "assassin" ? "assassin" : input.team,
                revealed_by: input.user_id,
            });
            if (input.outcome === "assassin") {
                await setGameStatus(client, input.game_id, "ended", "active");
                await setGameWinner(client, input.game_id, input.winner);
            }
            else {
                const ownWords = input.team === "red" ? locked.rows[0].red_team_words : locked.rows[0].blue_team_words;
                const remainingOwn = await client.query(`SELECT COUNT(*)::int AS count
             FROM unnest($2::text[]) AS word
            WHERE NOT EXISTS (
              SELECT 1 FROM codenames_revealed r
               WHERE r.game_id = $1 AND r.word = word
            )`, [input.game_id, ownWords ?? []]);
                if (Number(remainingOwn.rows[0].count) === 0) {
                    await setGameStatus(client, input.game_id, "ended", "active");
                    await setGameWinner(client, input.game_id, input.team);
                }
            }
        }
        else {
            // A wrong-team or neutral word always ends the turn. In addition, a clue
            // grants only a fixed number of guesses: spending the last one ends the
            // turn too, even for an invalid word. Without that second rule the
            // spymaster can hand out fresh clues forever and brute-force the board
            // without ever losing the turn.
            const after = await client.query(`SELECT COUNT(*)::int AS count FROM codenames_guesses WHERE clue_id = $1`, [active.id]);
            const turnOver = input.outcome === "wrong_team" || input.outcome === "neutral"
                || Number(after.rows[0].count) >= Number(active.number);
            if (turnOver)
                await setCurrentTeam(client, input.game_id, input.next_team);
        }
        await client.query("COMMIT");
        return guess;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
export async function listGuessesForGame(pool, gameId) {
    const result = await pool.query(`SELECT id, game_id, user_id, username, word, team, outcome, created_at
     FROM codenames_guesses WHERE game_id = $1
     ORDER BY created_at ASC`, [gameId]);
    return result.rows;
}
export async function listRevealedWords(pool, gameId) {
    const result = await pool.query(`SELECT game_id, word, team, revealed_by, revealed_at
     FROM codenames_revealed WHERE game_id = $1
     ORDER BY revealed_at ASC`, [gameId]);
    return result.rows;
}
export async function revealWord(pool, input) {
    // `pool` may be a checked-out client so submitGuess can keep the reveal in
    // the same transaction as the guess and the game state change.
    const result = await pool.query(`INSERT INTO codenames_revealed (game_id, word, team, revealed_by, revealed_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (game_id, word) DO NOTHING
     RETURNING game_id, word, team, revealed_by, revealed_at`, [input.game_id, input.word, input.team, input.revealed_by]);
    return result.rows[0] ?? null;
}
export async function setCurrentTeam(pool, id, team) {
    await pool.query(`UPDATE codenames_games SET current_team = $2 WHERE id = $1`, [id, team]);
}
export async function setGameWinner(pool, id, winner) {
    await pool.query(`UPDATE codenames_games SET winner = $2 WHERE id = $1`, [id, winner]);
}

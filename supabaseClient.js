const { createClient } = require('@supabase/supabase-js');

// use suas variáveis de ambiente ou coloque direto aqui
const supabaseUrl = process.env.SUPABASE_URL || 'https://nvlmtinpcayrpkhulefs.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_7AaXEKbS9roL57PO5lQkuQ_fkVWnGoL';

const supabaseClient = createClient(supabaseUrl, supabaseKey);

module.exports = supabaseClient;
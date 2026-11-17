-- Módulo Ley de Lobby TaskFlow (fuente directorio: planilla suministrada 17-11-2026)
BEGIN;
CREATE TABLE IF NOT EXISTS public.lobby_municipalities(
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  comuna text NOT NULL,
  region text NOT NULL,
  population_2024 integer,
  census_rank integer NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS public.lobby_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT internal.my_org(),
  municipality_id text NOT NULL REFERENCES public.lobby_municipalities(id),
  initiative text NOT NULL DEFAULT 'Por definir',
  matter text NOT NULL DEFAULT '',
  authority_role text NOT NULL DEFAULT '',
  authority_name text NOT NULL DEFAULT '',
  sent boolean NOT NULL DEFAULT false,
  requested_at date,
  folio text NOT NULL DEFAULT '',
  response text NOT NULL DEFAULT 'Sin respuesta'
    CHECK (response IN ('Sin respuesta','Aceptada','Rechazada','Revisar','Reprogramar','Cancelada')),
  response_at date,
  next_action_at date,
  next_action text NOT NULL DEFAULT '',
  meeting_at timestamptz,
  meeting_mode text NOT NULL DEFAULT '',
  done boolean NOT NULL DEFAULT false,
  minutes_done boolean NOT NULL DEFAULT false,
  owner_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lobby_requests_org_idx ON public.lobby_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lobby_requests_next_idx ON public.lobby_requests(organization_id, next_action_at);
CREATE INDEX IF NOT EXISTS lobby_requests_meeting_idx ON public.lobby_requests(organization_id, meeting_at);
CREATE INDEX IF NOT EXISTS lobby_requests_municipality_idx ON public.lobby_requests(municipality_id);
ALTER TABLE public.lobby_municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.lobby_municipalities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lobby_requests TO authenticated;
DO $policies$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lobby_municipalities' AND policyname='lobby_directory_select') THEN
CREATE POLICY lobby_directory_select ON public.lobby_municipalities FOR SELECT TO authenticated
USING (internal.my_org() IS NOT NULL);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lobby_requests' AND policyname='lobby_requests_read') THEN
CREATE POLICY lobby_requests_read ON public.lobby_requests FOR SELECT TO authenticated
USING (organization_id=internal.my_org() AND 'lobby'=ANY(COALESCE((SELECT module_access FROM public.profiles WHERE id=auth.uid()),'{}'::text[])));
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lobby_requests' AND policyname='lobby_requests_insert') THEN
CREATE POLICY lobby_requests_insert ON public.lobby_requests FOR INSERT TO authenticated
WITH CHECK (organization_id=internal.my_org() AND created_by=auth.uid()
AND internal.my_role()=ANY(ARRAY['super','admin','comercial'])
AND 'lobby'=ANY(COALESCE((SELECT module_access FROM public.profiles WHERE id=auth.uid()),'{}'::text[])));
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lobby_requests' AND policyname='lobby_requests_update') THEN
CREATE POLICY lobby_requests_update ON public.lobby_requests FOR UPDATE TO authenticated
USING (organization_id=internal.my_org() AND internal.my_role()=ANY(ARRAY['super','admin','comercial'])
AND 'lobby'=ANY(COALESCE((SELECT module_access FROM public.profiles WHERE id=auth.uid()),'{}'::text[])))
WITH CHECK (organization_id=internal.my_org() AND internal.my_role()=ANY(ARRAY['super','admin','comercial'])
AND 'lobby'=ANY(COALESCE((SELECT module_access FROM public.profiles WHERE id=auth.uid()),'{}'::text[])));
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lobby_requests' AND policyname='lobby_requests_delete') THEN
CREATE POLICY lobby_requests_delete ON public.lobby_requests FOR DELETE TO authenticated
USING (organization_id=internal.my_org() AND internal.my_role()=ANY(ARRAY['super','admin'])
AND 'lobby'=ANY(COALESCE((SELECT module_access FROM public.profiles WHERE id=auth.uid()),'{}'::text[])));
END IF;
END $policies$;
WITH raw AS (
  SELECT item, ord::int AS rank FROM unnest(string_to_array('Puente Alto|568086|12;Maipú|503635|12;Santiago|438856|12;Antofagasta|401096|0;La Florida|374836|12;Viña del Mar|334871|14;San Bernardo|306371|12;Las Condes|296134|12;Temuco|292518|6;Valparaíso|284938|14;Puerto Montt|277040|8;Coquimbo|263719|5;Rancagua|257744|7;La Serena|250141|5;Arica|241653|1;Ñuñoa|241467|12;Peñalolén|236478|12;Talca|232131|11;Concepción|230375|4;Pudahuel|227820|12;Los Ángeles|219441|4;Quilicura|205624|12;Iquique|199587|13;Chillán|190382|15;Estación Central|181049|12;La Pintana|175920|12;Colina|173293|12;Valdivia|170043|9;Copiapó|168831|2;Osorno|166455|8;Calama|166334|0;Quilpué|162559|14;Curicó|159968|11;El Bosque|155257|12;Recoleta|154615|12;San Pedro de la Paz|150992|4;San Miguel|150829|12;Talcahuano|147322|4;Lampa|145160|12;Providencia|143974|12;Renca|143622|12;Alto Hospicio|142086|13;Villa Alemana|139571|14;Melipilla|136325|12;Punta Arenas|132363|10;Quinta Normal|129351|12;Cerro Navia|127250|12;Macul|123800|12;Coronel|123648|4;Conchalí|121587|12;Ovalle|118696|5;Buin|116969|12;Independencia|116943|12;Lo Barnechea|112620|12;La Granja|112022|12;La Cisterna|103157|12;Huechuraba|101808|12;San Antonio|96770|14;Quillota|96753|14;Linares|96744|11;Pedro Aguirre Cerda|96062|12;San Joaquín|95602|12;Peñaflor|94402|12;Lo Prado|91290|12;La Reina|89870|12;Hualpén|87731|4;Lo Espejo|87295|12;Vitacura|86420|12;Chiguayante|85822|4;Cerrillos|85041|12;Padre Hurtado|81243|12;Padre Las Casas|80656|6;San Felipe|80413|14;Paine|78828|12;Talagante|76429|12;San Ramón|76002|12;San Fernando|75585|7;Villarrica|67737|6;Rengo|63620|7;Los Andes|63440|14;Maule|61081|11;Machalí|60875|7;Coyhaique|57823|3;Tomé|56907|4;Limache|56145|14;San Carlos|55847|15;Vallenar|54222|2;Angol|53022|6;Puerto Varas|52942|8;Calera|50631|14;San Vicente|49559|7;San Javier|49559|11;Penco|48971|4;Molina|48949|11;Concón|48294|14;San Clemente|47380|11;Constitución|47004|11;Castro|46997|8;Parral|45323|11;Cauquenes|42798|11;Lautaro|41936|6;Santa Cruz|41209|7;Ancud|40949|8;Lota|39980|4;Isla de Maipo|39274|12;La Ligua|39270|14;La Unión|38907|9;El Monte|37497|12;Chimbarongo|37258|7;Arauco|37163|4;Calbuco|36474|8;Graneros|35938|7;Quintero|35754|14;Curacaví|35165|12;Panguipulli|35098|9;Cañete|34640|4;Victoria|34464|6;Nueva Imperial|33988|6;Río Bueno|33363|9;Longaví|33299|11;Chillán Viejo|32688|15;Pucón|32321|6;Illapel|32009|5;Vilcún|31575|6;Cabrero|31256|4;Curanilahue|31119|4;Teno|30113|11;Monte Patria|29997|5;Casablanca|29876|14;Coihueco|29766|15;Requínoa|29508|7;Pirque|29060|12;Mulchén|29036|4;Quellón|28460|8;Vicuña|28047|5;Salamanca|27823|5;Las Cabras|27554|7;Mostazal|27394|7;Pitrufquén|27041|6;Freire|26164|6;Nacimiento|26140|4;Hualqui|25795|4;Calera de Tango|25491|12;Llaillay|25484|14;Tocopilla|25400|0;Lebu|25246|4;Loncoche|25158|6;Carahue|24957|6;La Cruz|24939|14;Cartagena|24599|14;Collipulli|24303|6;Natales|24152|10;Bulnes|23863|15;Laja|23706|4;Yumbel|23170|4;Aysén|23170|3;Mariquina|22973|9;Los Vilos|22879|5;Colbún|22637|11;Frutillar|22554|8;Puchuncaví|22539|14;Retiro|22310|11;Nogales|22136|14;Los Álamos|21950|4;Doñihue|21925|7;Los Lagos|21431|9;Coltauco|21373|7;Pichidegua|20363|7;San Esteban|20112|14;Yerbas Buenas|20035|11;Cabildo|20015|14;Pichilemu|19847|7;Paillaco|19802|9;Olmué|19778|14;Tiltil|19742|12;Purranque|19542|8;Sagrada Familia|19427|11;Hijuelas|19286|14;Cunco|19177|6;Quillón|19165|15;El Quisco|18971|14;Traiguén|18873|6;Caldera|18805|2;Nancagua|18723|7;Yungay|18680|15;Curacautín|18536|6;Llanquihue|18088|8;Villa Alegre|17919|11;San José de Maipo|17441|12;San Ignacio|17405|15;Putaendo|17336|14;Romeral|17233|11;Los Muermos|17162|8;Pozo Almonte|16878|13;Lanco|16876|9;Calle Larga|16597|14;El Tabo|16260|14;Chonchi|16078|8;Algarrobo|16076|14;Coelemu|15895|15;Tucapel|15729|4;Chépica|15668|7;Teodoro Schmidt|15639|6;Futrono|15635|9;María Pinto|15352|12;Santa María|15134|14;San Nicolás|15099|15;Maullín|15063|8;Santa Juana|14947|4;Dalcahue|14894|8;Río Claro|14276|11;Peumo|14243|7;Gorbea|14148|6;Mejillones|14084|0;Santa Bárbara|14075|4;Codegua|13955|7;Olivar|13901|7;Malloa|13882|7;Río Negro|13874|8;Catemu|13760|14;Quinta de Tilcoco|13558|7;El Carmen|13186|15;Santo Domingo|13171|14;Cholchol|13167|6;Palmilla|13060|7;Florida|12958|4;Combarbalá|12954|5;Saavedra|12877|6;Ñiquén|12797|15;Galvarino|12710|6;Pinto|12502|15;Peralillo|12493|7;Chañaral|12345|2;Fresia|12320|8;Purén|12184|6;Taltal|12097|0;Punitaqui|12076|5;Rinconada|11855|14;Tierra Amarilla|11846|2;Quirihue|11746|15;Puyehue|11712|8;Andacollo|11566|5;Diego de Almagro|11397|2;Rauco|11266|11;San Rafael|11230|11;San Pedro|11108|12;San Pablo|10883|8;Hualañé|10775|11;Negrete|10723|4;Renaico|10686|6;Lago Ranco|10527|9;Lonquimay|10247|6;Tirúa|10208|4;Petorca|10206|14;Toltén|10041|6;San Pedro de Atacama|9843|0;Quilleco|9700|4;Canela|9639|5;Curepto|9519|11;Hualaihué|9480|8;Chanco|9446|11;Placilla|9438|7;Huasco|9369|2;Lumaco|9253|6;Pelarco|9229|11;Pencahue|9181|11;Pemuco|8930|15;Navidad|8885|7;Puerto Octay|8865|8;Litueche|8852|7;Marchihue|8715|7;Pelluhue|8578|11;Quemchi|8409|8;Máfil|8074|9;Zapallar|7980|14;Coinco|7916|7;Lolol|7791|7;San Juan de la Costa|7776|8;Alhué|7768|12;Curarrehue|7733|6;Ercilla|7730|6;Quinchao|7678|8;Freirina|7577|2;Papudo|7561|14;Perquenco|7438|6;Los Sauces|7348|6;Panquehue|7269|14;Paredones|7228|7;Licantén|6892|11;Porvenir|6809|10;Melipeuco|6796|6;Ránquil|6508|15;Pica|6272|13;Trehuaco|6124|15;Alto Biobío|6016|4;Contulmo|5905|4;Ninhue|5763|15;Queilén|5690|8;Corral|5501|9;Cobquecura|5495|15;San Fabián|5245|15;Portezuelo|5203|15;Cisnes|5137|3;Chile Chico|4905|3;María Elena|4834|0;Isla de Pascua|4800|14;Alto del Carmen|4788|2;Vichuquén|4716|11;Paihuano|4649|5;La Estrella|4609|7;Pumanque|4559|7;Quilaco|4440|4;Antuco|4373|4;La Higuera|4335|5;Río Hurtado|4334|5;Cochamó|4199|8;Puqueldón|4048|8;Chaitén|4025|8;Empedrado|3990|11;Curaco de Vélez|3662|8;San Rosendo|3575|4;Cochrane|3458|3;Futaleufú|3062|8;Huara|2858|13;Río Ibáñez|2723|3;Palena|1903|8;Cabo de Hornos|1750|10;Guaitecas|1598|3;Putre|1547|1;Sierra Gorda|1472|0;Camiña|1335|13;Juan Fernández|904|14;Camarones|861|1;Colchane|790|13;Lago Verde|779|3;O''Higgins|647|3;General Lagos|508|1;Tortel|505|3;Primavera|431|10;Laguna Blanca|269|10;Ollagüe|256|0;San Gregorio|241|10;Torres del Paine|203|10;Timaukel|157|10;Río Verde|102|10',';')) WITH ORDINALITY AS x(item,ord)
)
INSERT INTO public.lobby_municipalities(id,name,comuna,region,population_2024,census_rank)
SELECT 'LOB-'||lpad(rank::text,4,'0'), 'Municipalidad de '||split_part(item,'|',1),
  split_part(item,'|',1), (ARRAY['Antofagasta','Arica y Parinacota','Atacama','Aysén del General Carlos Ibáñez del Campo','Biobío','Coquimbo','La Araucanía','Libertador General Bernardo O''Higgins','Los Lagos','Los Ríos','Magallanes y de la Antártica Chilena','Maule','Metropolitana de Santiago','Tarapacá','Valparaíso','Ñuble'])[split_part(item,'|',3)::int+1],
  split_part(item,'|',2)::int, rank
FROM raw
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, comuna=EXCLUDED.comuna,
  region=EXCLUDED.region, population_2024=EXCLUDED.population_2024, census_rank=EXCLUDED.census_rank;
UPDATE public.profiles SET module_access=array_append(module_access,'lobby')
WHERE role IN ('super','admin') AND NOT ('lobby'=ANY(COALESCE(module_access,'{}'::text[])));
ALTER TABLE public.profiles ALTER COLUMN module_access SET DEFAULT ARRAY[
'dashboard','leads','hyperfocus','pipeline','remarketing','implementation','templates','chilecompra','quotes','lobby']::text[];
COMMIT;